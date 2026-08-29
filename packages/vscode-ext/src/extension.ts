import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'path';
import {
  LanguageClient,
  State,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { buildInitializationOptions, type OpenplanetLspSettings } from './settings';
import { abbreviateHome } from './paths';
import { renderStatusBar, type StatusInfo } from './status';
import { buildStatusReport } from './statusReport';
import { probeServerVersion, probeTypeDb } from './serverProbe';

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let clientStateSub: vscode.Disposable | undefined;

/** Everything the status bar and the status document render from. */
let status: StatusInfo = { state: 'starting' };

/** How the binary was chosen, for the status document. */
let serverSource: string | undefined;
/** Raw (un-abbreviated) resolved binary path, for the probes. */
let resolvedServerPath: string | undefined;

/**
 * Set once `deactivate` runs. Every async continuation checks it: a probe or
 * a state event that lands after disposal must not resurrect the status item.
 */
let deactivated = false;

/** Serialize restarts: never run two stop->start chains concurrently. */
let restarting = false;
/** `restartVerbose` sets this; a plain restart clears it again. */
let verboseLogging = false;

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

function homeDir(): string | undefined {
  try {
    return os.homedir();
  } catch {
    return undefined;
  }
}

/**
 * Workspace folder that owns the active editor, falling back to the first
 * folder. In a multi-root workspace the answer changes as the user switches
 * editors, which is why this is recomputed on the editor-change event rather
 * than cached at activation.
 */
function activeWorkspaceRoot(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder) return folder.uri.fsPath;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Merge a patch into the status and repaint. The ONLY way the item changes. */
function setStatus(patch: Partial<StatusInfo>): void {
  if (deactivated) return;
  status = { ...status, ...patch };
  paintStatus();
}

function paintStatus(): void {
  if (!statusItem) return;
  const render = renderStatusBar(status);
  statusItem.text = render.text;
  statusItem.tooltip = render.tooltip;
  statusItem.accessibilityInformation = { label: render.ariaLabel };
  statusItem.backgroundColor = render.backgroundColorId
    ? new vscode.ThemeColor(render.backgroundColorId)
    : undefined;
  statusItem.show();
}

/**
 * Resolve the server binary.
 *
 * Order: serverPath setting (if it exists on disk) -> bundled extension
 * bin/ -> bare `openplanet-lsp` (resolved from PATH by the spawn itself).
 * A serverPath that is set but missing warns and falls through - a silent
 * hard failure would strand users who rename a binary. Unset settings
 * forward nothing so the workspace's .openplanet-lsp.toml keeps precedence
 * (see settings.ts).
 */
function resolveServerCommand(settings: OpenplanetLspSettings, extensionPath: string): string {
  const log = (msg: string) => outputChannel?.appendLine(`[resolve] ${msg}`);

  // 1. Explicit override - authoritative; if missing, surface it loudly
  //    rather than silently falling through.
  const override = settings.serverPath?.trim();
  if (override) {
    if (existsSync(override)) {
      log(`using serverPath override: ${override}`);
      serverSource = 'openplanetLsp.serverPath setting';
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
    serverSource = 'bundled with the extension';
    return bundled;
  }

  // 3. Bare command - the OS resolves it from PATH at spawn time.
  log('no override and no bundled binary; spawning bare "openplanet-lsp" (PATH)');
  serverSource = override ? 'PATH (serverPath override was missing)' : 'PATH';
  return 'openplanet-lsp';
}

/**
 * Ask the binary for its own version and its type DB stamps.
 *
 * Fire-and-forget, once per server start: the server does not report either
 * over LSP, and the status bar must never poll. Failures are silent - the
 * tooltip then says "unknown", which is itself a useful signal.
 */
function probeBinary(bin: string): void {
  const home = homeDir();
  void probeServerVersion(bin).then((serverVersion) => {
    if (!deactivated && serverVersion) setStatus({ serverVersion });
  });
  void probeTypeDb(bin).then((db) => {
    if (deactivated || !db) return;
    setStatus({ typeDb: { ...db, source: abbreviateHome(db.source, home) } });
  });
}

async function startClient(context: vscode.ExtensionContext): Promise<void> {
  const settings = readSettings();
  const serverBin = resolveServerCommand(settings, context.extensionPath);
  resolvedServerPath = serverBin;

  const home = homeDir();
  setStatus({
    serverPath: abbreviateHome(serverBin, home),
    gameTarget: settings.gameTarget,
    workspaceRoot: abbreviateHome(activeWorkspaceRoot(), home),
    // A previous run's versions would be a lie about the binary now starting.
    serverVersion: undefined,
    typeDb: undefined,
  });
  probeBinary(serverBin);

  const serverOptions: ServerOptions = {
    command: serverBin,
    // Force LSP mode explicitly (works with any future launch-routing change).
    args: ['--lsp'],
    transport: TransportKind.stdio,
    // `restartVerbose` turns the server's tracing filter up without the user
    // having to edit settings or a launch script (the server reads RUST_LOG).
    options: verboseLogging ? { env: { ...process.env, RUST_LOG: 'debug' } } : undefined,
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

  // The status bar is driven entirely from this event plus the start()
  // rejection below. No timers, no polling.
  // Deliberately NOT pushed onto context.subscriptions: a restart creates a
  // new client and a new subscription, and pushing each one would grow the
  // list for the life of the window. The previous sub is disposed here and
  // the last one in deactivate().
  clientStateSub?.dispose();
  clientStateSub = client.onDidChangeState((e) => {
    if (deactivated) return;
    if (e.newState === State.Running) {
      setStatus({ state: 'ready', failureReason: undefined });
    } else if (e.newState === State.Starting) {
      setStatus({ state: restarting ? 'restarting' : 'starting', failureReason: undefined });
    } else if (e.newState === State.Stopped) {
      // A stop we asked for during a restart is not a failure, and the item
      // already reads "restarting" - leave it alone.
      if (restarting) return;
      if (e.oldState === State.Running) {
        // Crash after a successful start: without this the item would sit on
        // "ready" forever while nothing works.
        setStatus({
          state: 'failed',
          failureReason: 'the server exited unexpectedly after starting - see the log',
        });
      }
      // Stopped-from-Starting is the failed-start path; start()'s rejection
      // below sets a far better reason than this event can.
    }
  });

  try {
    await client.start();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    outputChannel?.appendLine(`[error] failed to start server: ${detail}`);
    setStatus({ state: 'failed', failureReason: detail });
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

async function restartClient(context: vscode.ExtensionContext): Promise<void> {
  if (restarting) return;
  restarting = true;
  setStatus({ state: 'restarting', failureReason: undefined });
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

/** Gather everything `showStatus` prints. Only named settings - never env. */
function collectStatusReport(context: vscode.ExtensionContext): string {
  const settings = readSettings();
  const home = homeDir();
  const pkg = context.extension?.packageJSON as { version?: string } | undefined;
  return buildStatusReport({
    state: status.state,
    failureReason: status.failureReason,
    serverPath: resolvedServerPath,
    serverSource,
    serverVersion: status.serverVersion,
    typeDb: status.typeDb,
    gameTarget: settings.gameTarget,
    signatureMode: settings.signatureMode,
    unused: settings.unused,
    inactiveRegions: settings.inactiveRegions,
    defines: settings.defines,
    pluginRoots: settings.pluginRoots,
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    activeWorkspaceRoot: activeWorkspaceRoot(),
    extensionVersion: pkg?.version,
    vscodeVersion: vscode.version,
    platform: process.platform,
    home,
  });
}

/**
 * Return every module-level variable to its initial value.
 *
 * `activate` can legitimately run again in the same host process after a
 * `deactivate` (a dev-host reload, an extension update), and stale module
 * state from the previous life would otherwise paint a status bar item that
 * no longer exists.
 */
function resetModuleState(): void {
  client = undefined;
  outputChannel = undefined;
  statusItem = undefined;
  clientStateSub = undefined;
  status = { state: 'starting' };
  serverSource = undefined;
  resolvedServerPath = undefined;
  deactivated = false;
  restarting = false;
  verboseLogging = false;
}

export function activate(context: vscode.ExtensionContext): void {
  resetModuleState();
  outputChannel = vscode.window.createOutputChannel('Openplanet LSP');
  context.subscriptions.push(outputChannel);

  statusItem = vscode.window.createStatusBarItem(
    'openplanetLsp.status',
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusItem.name = 'Openplanet LSP';
  // One click to the log is the affordance that replaces most of the
  // "check the output channel" support burden.
  statusItem.command = 'openplanetLsp.showLogs';
  context.subscriptions.push(statusItem);

  setStatus({
    gameTarget: readSettings().gameTarget,
    workspaceRoot: abbreviateHome(activeWorkspaceRoot(), homeDir()),
  });

  void startClient(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('openplanetLsp.restart', () => {
      outputChannel?.appendLine('[command] manual restart requested');
      verboseLogging = false;
      void restartClient(context);
    }),
    vscode.commands.registerCommand('openplanetLsp.restartVerbose', () => {
      outputChannel?.appendLine('[command] verbose restart requested (RUST_LOG=debug)');
      verboseLogging = true;
      outputChannel?.show(true);
      void restartClient(context);
    }),
    vscode.commands.registerCommand('openplanetLsp.showLogs', () => {
      outputChannel?.show(true);
    }),
    vscode.commands.registerCommand('openplanetLsp.showStatus', async () => {
      const doc = await vscode.workspace.openTextDocument({
        content: collectStatusReport(context),
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    }),
  );

  // Multi-root: the interesting root is the one owning the editor you are
  // looking at, so follow the active editor rather than pinning folder 0.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      setStatus({ workspaceRoot: abbreviateHome(activeWorkspaceRoot(), homeDir()) });
    }),
  );

  // Settings are initialize-time only on the server (no didChangeConfiguration
  // handler there) - restart the client when they change. Debounced.
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
  deactivated = true;
  clientStateSub?.dispose();
  clientStateSub = undefined;
  statusItem?.dispose();
  statusItem = undefined;
  const stopping = client;
  client = undefined;
  // Stopping a client that never finished starting rejects; a rejected
  // deactivate() is logged by the host and helps nobody.
  return stopping?.stop().catch(() => undefined);
}
