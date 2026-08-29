import * as vscode from 'vscode';
import { existsSync, realpathSync } from 'node:fs';
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
import { abbreviateHome, abbreviateHomeInText } from './paths';
import { renderStatusBar, type StatusInfo } from './status';
import { buildStatusReport } from './statusReport';
import { probeServerVersion, probeTypeDb } from './serverProbe';

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let clientStateSub: vscode.Disposable | undefined;
/** Debounced configuration restart; owned by this activation lifecycle. */
let restartTimer: ReturnType<typeof setTimeout> | undefined;

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

/** Invalidates stale starts, probes and state events across every lifecycle. */
let startGeneration = 0;

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

/** Logical HOME plus the physical path when HOME is a symlink. */
function homeAliases(home = homeDir()): string[] {
  if (!home) return [];
  try {
    const physical = realpathSync(home);
    return physical === home ? [home] : [home, physical];
  } catch {
    return [home];
  }
}

function redactHome(text: string | undefined, home = homeDir()): string | undefined {
  return abbreviateHomeInText(text, homeAliases(home));
}

function isCurrentStart(generation: number, candidate?: LanguageClient): boolean {
  return !deactivated && startGeneration === generation && (!candidate || client === candidate);
}

function clearRestartTimer(): void {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = undefined;
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
 * Order: serverPath setting (authoritative) -> bundled extension bin/ -> bare
 * `openplanet-lsp` (resolved from PATH by the spawn itself). Unset settings
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
    serverSource = 'openplanetLsp.serverPath setting (missing)';
    return override;
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
  serverSource = 'PATH';
  return 'openplanet-lsp';
}

/**
 * Ask the binary for its own version and its type DB stamps.
 *
 * Fire-and-forget, once per server start: the server does not report either
 * over LSP, and the status bar must never poll. Failures are silent - the
 * tooltip then says "unknown", which is itself a useful signal.
 */
function probeBinary(bin: string, generation: number): void {
  const home = homeDir();
  void probeServerVersion(bin).then((serverVersion) => {
    if (isCurrentStart(generation) && serverVersion) setStatus({ serverVersion });
  });
  void probeTypeDb(bin).then((db) => {
    if (!isCurrentStart(generation) || !db) return;
    setStatus({ typeDb: { ...db, source: redactHome(db.source, home) } });
  });
}

async function startClient(
  context: vscode.ExtensionContext,
  generation = ++startGeneration,
): Promise<void> {
  if (!isCurrentStart(generation)) return;
  const settings = readSettings();
  const serverBin = resolveServerCommand(settings, context.extensionPath);
  if (!isCurrentStart(generation)) return;
  resolvedServerPath = serverBin;

  const home = homeDir();
  setStatus({
    serverPath: redactHome(serverBin, home),
    gameTarget: settings.gameTarget,
    workspaceRoot: abbreviateHome(activeWorkspaceRoot(), home),
    // A previous run's versions would be a lie about the binary now starting.
    serverVersion: undefined,
    typeDb: undefined,
  });
  probeBinary(serverBin, generation);

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

  if (!isCurrentStart(generation)) return;
  const newClient = new LanguageClient(
    'openplanet-lsp',
    'Openplanet LSP',
    serverOptions,
    clientOptions,
  );
  if (!isCurrentStart(generation)) {
    newClient.dispose();
    return;
  }
  client = newClient;
  context.subscriptions.push(newClient);

  // The status bar is driven entirely from this event plus the start()
  // rejection below. No timers, no polling.
  // Deliberately NOT pushed onto context.subscriptions: a restart creates a
  // new client and a new subscription, and pushing each one would grow the
  // list for the life of the window. The previous sub is disposed here and
  // the last one in deactivate().
  clientStateSub?.dispose();
  clientStateSub = newClient.onDidChangeState((e) => {
    if (!isCurrentStart(generation, newClient)) return;
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
    await newClient.start();
    if (!isCurrentStart(generation, newClient)) return;
  } catch (err) {
    if (!isCurrentStart(generation, newClient)) return;
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
  if (deactivated || restarting) return;
  const generation = ++startGeneration;
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
    if (!isCurrentStart(generation)) return;
    await startClient(context, generation);
  } finally {
    if (startGeneration === generation) restarting = false;
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
    homeAliases: homeAliases(home),
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
  clearRestartTimer();
  startGeneration += 1;
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
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('openplanetLsp')) return;
      clearRestartTimer();
      restartTimer = setTimeout(() => {
        restartTimer = undefined;
        if (deactivated) return;
        outputChannel?.appendLine('[config] openplanetLsp settings changed; restarting server');
        void restartClient(context);
      }, 1000);
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  deactivated = true;
  startGeneration += 1;
  restarting = false;
  clearRestartTimer();
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
