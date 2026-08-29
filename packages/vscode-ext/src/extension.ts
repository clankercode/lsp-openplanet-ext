import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import * as path from 'path';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { buildInitializationOptions, type OpenplanetLspSettings } from './settings';

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel | undefined;

/** Read the openplanetLsp settings section into the plain settings shape. */
function readSettings(): OpenplanetLspSettings {
  const config = vscode.workspace.getConfiguration('openplanetLsp');
  return {
    serverPath: config.get<string>('serverPath', ''),
    openplanetDir: config.get<string>('openplanetDir', ''),
    pluginsDir: config.get<string>('pluginsDir', ''),
    gameTarget: config.get<string>('gameTarget', 'TMNEXT'),
    signatureMode: config.get<string>('signatureMode', 'developer'),
    defines: config.get<string[]>('defines', []),
    pluginRoots: config.get<string[]>('pluginRoots', []),
    unused: config.get<string>('unused', ''),
    inactiveRegions: config.get<string>('inactiveRegions', ''),
  };
}

/**
 * Resolve the server binary.
 *
 * Order: serverPath setting (if it exists on disk) → bundled extension
 * bin/ → bare `openplanet-lsp` (resolved from PATH by the spawn itself).
 * A serverPath that is set but missing warns and falls through — a silent
 * hard failure would strand users who rename a binary. Unset settings
 * forward nothing so the workspace's .openplanet-lsp.toml keeps precedence
 * (see settings.ts).
 */
function resolveServerCommand(settings: OpenplanetLspSettings, extensionPath: string): string {
  const log = (msg: string) => outputChannel?.appendLine(`[resolve] ${msg}`);

  // 1. Explicit override — authoritative; if missing, surface it loudly
  //    rather than silently falling through.
  const override = settings.serverPath?.trim();
  if (override) {
    if (existsSync(override)) {
      log(`using serverPath override: ${override}`);
      return override;
    }
    log(`serverPath override not found: ${override}`);
    void vscode.window
      .showWarningMessage(
        `openplanetLsp.serverPath is set but does not exist: ${override}`,
        'Open Settings',
      )
      .then((choice) => {
        if (choice === 'Open Settings') {
          void vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'openplanetLsp.serverPath',
          );
        }
      });
  }

  // 2. Bundled binary (per-platform VSIX builds drop it here).
  const bundled = path.join(
    extensionPath,
    'bin',
    process.platform === 'win32' ? 'openplanet-lsp.exe' : 'openplanet-lsp',
  );
  if (existsSync(bundled)) {
    log(`using bundled binary: ${bundled}`);
    return bundled;
  }

  // 3. Bare command — the OS resolves it from PATH at spawn time.
  log('no override and no bundled binary; spawning bare "openplanet-lsp" (PATH)');
  return 'openplanet-lsp';
}

async function startClient(context: vscode.ExtensionContext): Promise<void> {
  const settings = readSettings();
  const serverBin = resolveServerCommand(settings, context.extensionPath);

  const serverOptions: ServerOptions = {
    command: serverBin,
    // Force LSP mode explicitly (works with any future launch-routing change).
    args: ['--lsp'],
    transport: TransportKind.stdio,
  };

  const initializationOptions = buildInitializationOptions(settings);
  outputChannel?.appendLine(
    `[init] initializationOptions: ${JSON.stringify(initializationOptions)}`,
  );

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'angelscript' },
      { scheme: 'untitled', language: 'angelscript' },
      // info.toml (plugin manifest) diagnostics: the server reacts to
      // didOpen for it by URI suffix.
      { scheme: 'file', pattern: '**/info.toml' },
    ],
    synchronize: {
      // Forward-looking: vscode-languageclient only forwards these events once
      // the server declares the watched-files capability. The server has no
      // didChangeWatchedFiles handler today; one for **/info.toml (workspace
      // add/remove/rebuild per the multi-root spec, t9) is landing separately.
      // Keeping both watchers wired means external .as edits and plugin-root
      // lifecycle events start flowing the moment the server gains support,
      // without an extension update.
      fileEvents: [
        vscode.workspace.createFileSystemWatcher('**/*.as'),
        vscode.workspace.createFileSystemWatcher('**/info.toml'),
      ],
    },
    outputChannel,
    initializationOptions,
  };

  client = new LanguageClient('openplanet-lsp', 'Openplanet LSP', serverOptions, clientOptions);
  context.subscriptions.push(client);

  try {
    await client.start();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    outputChannel?.appendLine(`[error] failed to start server: ${detail}`);
    void vscode.window
      .showErrorMessage(
        `Openplanet LSP failed to start: ${detail}. ` +
          'Is openplanet-lsp installed? (settings: openplanetLsp.serverPath)',
        'Open Settings',
        'Show Logs',
      )
      .then((choice) => {
        if (choice === 'Open Settings') {
          void vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'openplanetLsp.serverPath',
          );
        } else if (choice === 'Show Logs') {
          outputChannel?.show();
        }
      });
  }
}

/** Serialize restarts: never run two stop→start chains concurrently. */
let restarting = false;

async function restartClient(context: vscode.ExtensionContext): Promise<void> {
  if (restarting) return;
  restarting = true;
  try {
    const old = client;
    client = undefined;
    if (old) {
      const idx = context.subscriptions.indexOf(old);
      if (idx >= 0) context.subscriptions.splice(idx, 1);
      await old.stop().catch(() => {});
      old.dispose();
    }
    await startClient(context);
  } finally {
    restarting = false;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Openplanet LSP');
  context.subscriptions.push(outputChannel);

  void startClient(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('openplanetLsp.restart', () => {
      outputChannel?.appendLine('[command] manual restart requested');
      void restartClient(context);
    }),
  );

  // Settings are initialize-time only on the server (no didChangeConfiguration
  // handler there) — restart the client when they change. Debounced.
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('openplanetLsp')) return;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        outputChannel?.appendLine('[config] openplanetLsp settings changed; restarting server');
        void restartClient(context);
      }, 1000);
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
