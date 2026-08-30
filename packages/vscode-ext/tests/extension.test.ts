import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as fakeVscode from './mocks/vscode';
import * as ext from '../src/extension';
import type * as DefinesCommandsModule from '../src/definesCommands';

/**
 * Activation-level tests for the status bar and commands (B043).
 *
 * `vscode` is aliased to ./mocks/vscode (see vitest.config.ts) and
 * `vscode-languageclient/node` is mocked below, so `activate()` can be run
 * for real without an extension host. Everything asserted here is behaviour a
 * user would notice: which commands exist, what the status bar says in each
 * server state, and whether disposal actually disposes.
 */

const lc = vi.hoisted(() => {
  const State = { Stopped: 1, Running: 2, Starting: 3 } as const;

  class FakeLanguageClient {
    static instances: FakeLanguageClient[] = [];
    /** Rejection for the NEXT start() call. */
    static nextStartError: Error | undefined;
    /** When set, start() waits on this before resolving. */
    static startGate: Promise<void> | undefined;

    stateListeners: ((e: { oldState: number; newState: number }) => void)[] = [];
    stopCount = 0;
    disposeCount = 0;
    running = false;

    /** Requests the extension sent, in order (B050). */
    static requests: { method: string; params: unknown }[] = [];
    /** Canned answers by method; an unlisted method rejects, as the real
     *  router does with MethodNotFound. */
    static responses: Record<string, unknown> = {};

    /** `extension.ts` gates the B050 request on this. */
    get state(): number {
      return this.running ? State.Running : State.Stopped;
    }

    async sendRequest(method: string, params: unknown): Promise<unknown> {
      FakeLanguageClient.requests.push({ method, params });
      if (method in FakeLanguageClient.responses) return FakeLanguageClient.responses[method];
      throw new Error(`Unhandled method ${method}`);
    }

    constructor(
      readonly id: string,
      readonly name: string,
      readonly serverOptions: Record<string, unknown>,
      readonly clientOptions: Record<string, unknown>,
    ) {
      FakeLanguageClient.instances.push(this);
    }

    fire(oldState: number, newState: number): void {
      for (const l of [...this.stateListeners]) l({ oldState, newState });
    }

    onDidChangeState(listener: (e: { oldState: number; newState: number }) => void) {
      this.stateListeners.push(listener);
      return {
        dispose: () => {
          this.stateListeners = this.stateListeners.filter((l) => l !== listener);
        },
      };
    }

    async start(): Promise<void> {
      this.fire(State.Stopped, State.Starting);
      if (FakeLanguageClient.startGate) await FakeLanguageClient.startGate;
      const err = FakeLanguageClient.nextStartError;
      if (err) {
        FakeLanguageClient.nextStartError = undefined;
        this.fire(State.Starting, State.Stopped);
        throw err;
      }
      this.running = true;
      this.fire(State.Starting, State.Running);
    }

    async stop(): Promise<void> {
      this.stopCount += 1;
      if (this.running) {
        this.running = false;
        this.fire(State.Running, State.Stopped);
      }
    }

    dispose(): void {
      this.disposeCount += 1;
    }

    /** Simulate the server dying after a successful start. */
    crash(): void {
      this.running = false;
      this.fire(State.Running, State.Stopped);
    }

    static reset(): void {
      FakeLanguageClient.instances = [];
      FakeLanguageClient.nextStartError = undefined;
      FakeLanguageClient.startGate = undefined;
      FakeLanguageClient.requests = [];
      FakeLanguageClient.responses = {};
    }
  }

  return { State, FakeLanguageClient };
});

/**
 * B050: capture the introspection provider `activate()` installs, without
 * putting a test-only export in production code. Everything else is the real
 * module, so the command table and handlers below are unaffected.
 */
const defines = vi.hoisted(() => ({
  installed: [] as (((uri?: string) => Promise<unknown>) | undefined)[],
}));

vi.mock('../src/definesCommands', async () => {
  const actual = await vi.importActual<typeof DefinesCommandsModule>('../src/definesCommands');
  return {
    ...actual,
    setResolvedDefinesProvider: (provider?: (uri?: string) => Promise<unknown>) => {
      defines.installed.push(provider);
      actual.setResolvedDefinesProvider(
        provider as Parameters<typeof actual.setResolvedDefinesProvider>[0],
      );
    },
  };
});

vi.mock('vscode-languageclient/node', () => ({
  LanguageClient: lc.FakeLanguageClient,
  State: lc.State,
  TransportKind: { stdio: 'stdio' },
}));

const probes = vi.hoisted(() => ({
  probeServerVersion: vi.fn<() => Promise<string | undefined>>(),
  probeTypeDb:
    vi.fn<() => Promise<{ core?: string; game?: string; source?: string } | undefined>>(),
}));

// The probes spawn a real binary; in tests there is none, and a spawn per
// activation would make the suite slow and machine-dependent.
vi.mock('../src/serverProbe', () => ({
  probeServerVersion: probes.probeServerVersion,
  probeTypeDb: probes.probeTypeDb,
  PROBE_TIMEOUT_MS: 5_000,
}));

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
  activationEvents: string[];
  contributes: { commands: { command: string; title: string; category?: string }[] };
};

/** Commands this extension owns. */
const EXPECTED_COMMANDS = [
  'openplanetLsp.restart',
  'openplanetLsp.restartVerbose',
  'openplanetLsp.showLogs',
  'openplanetLsp.showStatus',
  // The server-side type-database regeneration (B039).
  'openplanetLsp.regenerateTypeDb',
  // The defines UI (B034).
  'openplanetLsp.defines.manage',
  'openplanetLsp.defines.add',
  'openplanetLsp.defines.remove',
  'openplanetLsp.defines.clearOverrides',
];

const EXPECTED_ACTIVATION_EVENTS = [
  'onLanguage:angelscript',
  'workspaceContains:**/info.toml',
  ...EXPECTED_COMMANDS.map((id) => `onCommand:${id}`),
];

interface FakeContext {
  subscriptions: { dispose(): void }[];
  extensionPath: string;
  extension: { packageJSON: { version: string } };
}

function makeContext(): FakeContext {
  return {
    subscriptions: [],
    extensionPath: '/nonexistent-extension-path',
    extension: { packageJSON: { version: '9.9.9' } },
  };
}

/**
 * Imported once. `activate()` resets its own module state, so tests share the
 * instance deliberately: re-importing under `vi.resetModules()` would hand the
 * extension a SECOND copy of the aliased `vscode` mock and every assertion
 * here would silently read the wrong recorder.
 */
async function loadExtension(): Promise<typeof ext> {
  return ext;
}

function statusItem(): fakeVscode.FakeStatusBarItem {
  const items = fakeVscode.recorded.statusBarItems;
  expect(items.length).toBeGreaterThan(0);
  return items[items.length - 1];
}

function outputChannel(): fakeVscode.FakeOutputChannel {
  const channels = fakeVscode.recorded.outputChannels;
  expect(channels.length).toBeGreaterThan(0);
  return channels[channels.length - 1];
}

async function run(command: string): Promise<unknown> {
  const handler = fakeVscode.recorded.commands.get(command);
  expect(handler, `command not registered: ${command}`).toBeDefined();
  return await handler!();
}

/** Let queued microtasks (start(), the probes) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

let unhandled: unknown[] = [];
function onUnhandled(reason: unknown): void {
  unhandled.push(reason);
}

beforeEach(() => {
  fakeVscode.__reset();
  lc.FakeLanguageClient.reset();
  defines.installed.length = 0;
  probes.probeServerVersion.mockReset();
  probes.probeServerVersion.mockResolvedValue('9.9.9-probe');
  probes.probeTypeDb.mockReset();
  probes.probeTypeDb.mockResolvedValue({
    core: '1.29.5',
    game: '1.29.5',
    source: `${homedir()}/OpenplanetNext`,
  });
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  fakeVscode.__setWorkspaceFolders([`${homedir()}/src/my-plugin`]);
  fakeVscode.__setActiveEditor(`${homedir()}/src/my-plugin/src/Main.as`);
});

afterEach(() => {
  vi.useRealTimers();
  process.off('unhandledRejection', onUnhandled);
});

describe('contributes.commands (package.json)', () => {
  it.each(EXPECTED_COMMANDS)('%s has a palette entry', (id) => {
    const entry = pkg.contributes.commands.find((c) => c.command === id);
    expect(entry, `missing from contributes.commands: ${id}`).toBeDefined();
    expect(entry!.title.length).toBeGreaterThan(0);
    expect(entry!.category).toBe('Openplanet LSP');
  });

  it('contributes no command the extension does not register', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    for (const c of pkg.contributes.commands) {
      expect(
        fakeVscode.recorded.commands.has(c.command),
        `contributed but never registered: ${c.command}`,
      ).toBe(true);
    }
    await ext.deactivate();
  });

  it('contributes the CLIENT id for regenerateTypeDb, never the server one', () => {
    // B039: the palette entry is `openplanetLsp.regenerateTypeDb`, a command
    // this extension registers. `openplanet.regenerateTypeDb` is the name the
    // SERVER advertises; contributing that one would give the palette an
    // entry no registered handler answers.
    const ids = pkg.contributes.commands.map((c) => c.command);
    expect(ids).toContain('openplanetLsp.regenerateTypeDb');
    expect(ids).not.toContain('openplanet.regenerateTypeDb');
  });

  it('declares the complete explicit language, workspace and command activation contract', () => {
    expect([...pkg.activationEvents].sort()).toEqual([...EXPECTED_ACTIVATION_EVENTS].sort());
  });

  it('does not activate on every window', () => {
    expect(pkg.activationEvents).not.toContain('*');
    expect(pkg.activationEvents).not.toContain('onStartupFinished');
  });
});

describe('activation', () => {
  it.each(EXPECTED_COMMANDS)('registers %s', async (id) => {
    // Registration and palette presence are separate failures: a command can
    // be in package.json and throw "command not found" when invoked.
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    expect(fakeVscode.recorded.commands.has(id)).toBe(true);
    await ext.deactivate();
  });

  it('creates a status bar item that opens the log when clicked', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    const item = statusItem();
    expect(item.command).toBe('openplanetLsp.showLogs');
    expect(item.shownCount).toBeGreaterThan(0);
    expect(item.text.length).toBeGreaterThan(0);
    await ext.deactivate();
  });

  it('registers the status item and channel as subscriptions', async () => {
    const ext = await loadExtension();
    const ctx = makeContext();
    ext.activate(ctx as never);
    await settle();
    expect(ctx.subscriptions).toContain(statusItem() as unknown as { dispose(): void });
    expect(ctx.subscriptions).toContain(outputChannel() as unknown as { dispose(): void });
    await ext.deactivate();
  });
});

describe('server state -> status bar', () => {
  it('reaches ready after a successful start', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    expect(statusItem().text).toContain('Openplanet');
    expect(statusItem().tooltip).toContain('ready');
    expect(statusItem().backgroundColor).toBeUndefined();
    await ext.deactivate();
  });

  it('shows starting before the start resolves', async () => {
    let release: () => void = () => {};
    lc.FakeLanguageClient.startGate = new Promise<void>((r) => {
      release = r;
    });
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    expect(statusItem().tooltip).toContain('Starting');
    release();
    await settle();
    expect(statusItem().tooltip).toContain('ready');
    await ext.deactivate();
  });

  it('goes to a distinguished failure state when the server never starts', async () => {
    lc.FakeLanguageClient.nextStartError = new Error('spawn openplanet-lsp ENOENT');
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    const item = statusItem();
    expect(item.text).toContain('failed');
    expect(item.backgroundColor?.id).toBe('statusBarItem.errorBackground');
    expect(item.tooltip).toContain('spawn openplanet-lsp ENOENT');
    expect(unhandled).toEqual([]);
    await ext.deactivate();
  });

  it('redacts the home directory from a startup failure tooltip', async () => {
    lc.FakeLanguageClient.nextStartError = new Error(
      `spawn ${homedir()}/.local/bin/openplanet-lsp ENOENT`,
    );
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();

    const tooltip = statusItem().tooltip!;
    expect(tooltip).not.toContain(homedir());
    expect(tooltip).toContain('spawn ~/.local/bin/openplanet-lsp ENOENT');
    await ext.deactivate();
  });

  it('redacts a standalone home directory before terminal punctuation in a startup failure tooltip', async () => {
    lc.FakeLanguageClient.nextStartError = new Error(`failed to open ${homedir()}.`);
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();

    const tooltip = statusItem().tooltip!;
    expect(tooltip).not.toContain(homedir());
    expect(tooltip).toContain('failed to open ~.');
    await ext.deactivate();
  });

  it('redacts the workspace root in the status tooltip', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();

    const tooltip = statusItem().tooltip!;
    expect(tooltip).not.toContain(homedir());
    expect(tooltip).toContain('Workspace:   ~/src/my-plugin');
    await ext.deactivate();
  });

  it('uses a missing serverPath override as the command and reports its failure', async () => {
    fakeVscode.__setConfig({ 'openplanetLsp.serverPath': '/no/such/openplanet-lsp' });
    lc.FakeLanguageClient.nextStartError = new Error('spawn openplanet-lsp ENOENT');
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    expect(fakeVscode.recorded.warnings.join('\n')).toContain('/no/such/openplanet-lsp');
    expect(lc.FakeLanguageClient.instances[0].serverOptions.command).toBe(
      '/no/such/openplanet-lsp',
    );
    expect(statusItem().text).toContain('failed');
    expect(unhandled).toEqual([]);
    await ext.deactivate();
  });

  it('updates rather than going stale when the server crashes after starting', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    expect(statusItem().tooltip).toContain('ready');

    lc.FakeLanguageClient.instances[0].crash();
    await settle();
    const item = statusItem();
    expect(item.text).toContain('failed');
    expect(item.backgroundColor?.id).toBe('statusBarItem.errorBackground');
    expect(item.tooltip).toMatch(/unexpectedly/i);
    await ext.deactivate();
  });

  it('shows restarting, then ready, on a manual restart', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();

    let release: () => void = () => {};
    lc.FakeLanguageClient.startGate = new Promise<void>((r) => {
      release = r;
    });
    void run('openplanetLsp.restart');
    await settle();
    expect(statusItem().tooltip).toContain('Restarting');

    release();
    lc.FakeLanguageClient.startGate = undefined;
    await settle();
    expect(statusItem().tooltip).toContain('ready');
    await ext.deactivate();
  });

  it('serializes back-to-back restart requests into one replacement client', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();

    void run('openplanetLsp.restart');
    void run('openplanetLsp.restart');
    await settle();

    expect(lc.FakeLanguageClient.instances).toHaveLength(2);
    expect(statusItem().tooltip).toContain('ready');
    await ext.deactivate();
  });

  it('renders four visually distinct states', async () => {
    // starting / ready / restarting / failed must not collapse into one look.
    const seen = new Set<string>();
    const ext = await loadExtension();

    let release: () => void = () => {};
    lc.FakeLanguageClient.startGate = new Promise<void>((r) => {
      release = r;
    });
    ext.activate(makeContext() as never);
    await settle();
    seen.add(statusItem().text);
    release();
    lc.FakeLanguageClient.startGate = undefined;
    await settle();
    seen.add(statusItem().text);

    lc.FakeLanguageClient.startGate = new Promise<void>((r) => {
      release = r;
    });
    void run('openplanetLsp.restart');
    await settle();
    seen.add(statusItem().text);
    release();
    lc.FakeLanguageClient.startGate = undefined;
    await settle();

    lc.FakeLanguageClient.instances.at(-1)!.crash();
    await settle();
    seen.add(statusItem().text);

    expect(seen.size).toBe(4);
    await ext.deactivate();
  });
});

describe('commands', () => {
  it('showLogs reveals the output channel', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    const before = outputChannel().shownCount;
    await run('openplanetLsp.showLogs');
    expect(outputChannel().shownCount).toBe(before + 1);
    await ext.deactivate();
  });

  it('showStatus opens a document with the resolved config', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    await run('openplanetLsp.showStatus');

    const doc = fakeVscode.recorded.openedTextDocuments.at(-1);
    expect(doc).toBeDefined();
    expect(doc!.language).toBe('markdown');
    expect(doc!.content).toContain('openplanet-lsp');
    expect(doc!.content).toContain('9.9.9-probe');
    expect(doc!.content).toContain('1.29.5');
    expect(doc!.content).toContain('TMNEXT');
    expect(fakeVscode.recorded.shownTextDocuments).toContain(doc!);
    await ext.deactivate();
  });

  it('showStatus abbreviates $HOME to ~', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    await run('openplanetLsp.showStatus');
    const content = fakeVscode.recorded.openedTextDocuments.at(-1)!.content;
    expect(content).not.toContain(homedir());
    expect(content).toContain('~/src/my-plugin');
    await ext.deactivate();
  });

  it('keeps the newest binary and probe data when an older probe resolves late', async () => {
    let releaseOldVersion: (value: string) => void = () => {};
    let releaseOldDb: (value: { core: string; source: string }) => void = () => {};
    probes.probeServerVersion.mockImplementationOnce(
      () => new Promise<string>((resolve) => (releaseOldVersion = resolve)),
    );
    probes.probeServerVersion.mockResolvedValueOnce('2.0.0-new');
    probes.probeTypeDb.mockImplementationOnce(
      () => new Promise((resolve) => (releaseOldDb = resolve)),
    );
    probes.probeTypeDb.mockResolvedValueOnce({ core: '2.0-db', source: `${homedir()}/new-db` });
    fakeVscode.__setConfig({ 'openplanetLsp.serverPath': 'old-lsp' });

    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    fakeVscode.__setConfig({ 'openplanetLsp.serverPath': 'new-lsp' });
    await run('openplanetLsp.restart');
    await settle();

    releaseOldVersion('1.0.0-old');
    releaseOldDb({ core: '1.0-db', source: `${homedir()}/old-db` });
    await settle();
    await run('openplanetLsp.showStatus');

    const content = fakeVscode.recorded.openedTextDocuments.at(-1)!.content;
    expect(content).toContain('new-lsp');
    expect(content).toContain('2.0.0-new');
    expect(content).toContain('2.0-db');
    expect(content).not.toContain('1.0.0-old');
    expect(content).not.toContain('1.0-db');
    await ext.deactivate();
  });

  it('restartVerbose restarts with RUST_LOG turned up', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    await run('openplanetLsp.restartVerbose');
    await settle();

    const latest = lc.FakeLanguageClient.instances.at(-1)!;
    const options = latest.serverOptions.options as { env?: Record<string, string> } | undefined;
    expect(options?.env?.RUST_LOG).toBe('debug');
    await ext.deactivate();
  });

  it('a plain restart turns verbose logging back off', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    await run('openplanetLsp.restartVerbose');
    await settle();
    await run('openplanetLsp.restart');
    await settle();

    const latest = lc.FakeLanguageClient.instances.at(-1)!;
    expect(latest.serverOptions.options).toBeUndefined();
    await ext.deactivate();
  });

  it('commands invoked before the start completes do not throw', async () => {
    let release: () => void = () => {};
    lc.FakeLanguageClient.startGate = new Promise<void>((r) => {
      release = r;
    });
    const ext = await loadExtension();
    ext.activate(makeContext() as never);

    // No settle(): the client is still starting.
    await expect(run('openplanetLsp.showStatus')).resolves.not.toThrow();
    await expect(run('openplanetLsp.showLogs')).resolves.not.toThrow();
    const content = fakeVscode.recorded.openedTextDocuments.at(-1)!.content;
    expect(content).toContain('starting');

    release();
    await settle();
    expect(unhandled).toEqual([]);
    await ext.deactivate();
  });
});

describe('workspace shapes', () => {
  it('works with no workspace folder open', async () => {
    fakeVscode.__setWorkspaceFolders(undefined);
    fakeVscode.__setActiveEditor(undefined);
    const ext = await loadExtension();
    expect(() => ext.activate(makeContext() as never)).not.toThrow();
    await settle();

    await run('openplanetLsp.showStatus');
    const content = fakeVscode.recorded.openedTextDocuments.at(-1)!.content;
    expect(content).toContain('(none)');
    expect(statusItem().tooltip).toContain('unknown');
    expect(unhandled).toEqual([]);
    await ext.deactivate();
  });

  it('reflects the ACTIVE editor root in a multi-root workspace', async () => {
    const a = `${homedir()}/src/plugin-a`;
    const b = `${homedir()}/src/plugin-b`;
    fakeVscode.__setWorkspaceFolders([a, b]);
    fakeVscode.__setActiveEditor(`${a}/src/Main.as`);

    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    expect(statusItem().tooltip).toContain('~/src/plugin-a');
    expect(statusItem().tooltip).not.toContain('~/src/plugin-b');

    // Switching editors must move the indicator with it.
    fakeVscode.__setActiveEditor(`${b}/src/Main.as`);
    fakeVscode.__fireActiveEditorChange();
    expect(statusItem().tooltip).toContain('~/src/plugin-b');
    expect(statusItem().tooltip).not.toContain('~/src/plugin-a');
    await ext.deactivate();
  });

  it('selects the longest matching root for an editor in nested workspace folders', async () => {
    const outer = `${homedir()}/src/plugin`;
    const nested = `${outer}/vendor/nested-plugin`;
    fakeVscode.__setWorkspaceFolders([outer, nested]);
    fakeVscode.__setActiveEditor(`${nested}/src/Main.as`);

    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    expect(statusItem().tooltip).toContain('~/src/plugin/vendor/nested-plugin');
    await ext.deactivate();
  });

  it('falls back to the first folder when no editor is active', async () => {
    const a = `${homedir()}/src/plugin-a`;
    fakeVscode.__setWorkspaceFolders([a, `${homedir()}/src/plugin-b`]);
    fakeVscode.__setActiveEditor(undefined);
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    expect(statusItem().tooltip).toContain('~/src/plugin-a');
    await ext.deactivate();
  });
});

describe('deactivate', () => {
  it('disposes the status bar item', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    const item = statusItem();
    expect(item.disposeCount).toBe(0);
    await ext.deactivate();
    expect(item.disposeCount).toBeGreaterThan(0);
  });

  it('disposes cleanly while the server is still starting', async () => {
    let release: () => void = () => {};
    lc.FakeLanguageClient.startGate = new Promise<void>((r) => {
      release = r;
    });
    const ext = await loadExtension();
    ext.activate(makeContext() as never);

    const item = statusItem();
    await expect(ext.deactivate() ?? Promise.resolve()).resolves.not.toThrow();
    expect(item.disposeCount).toBeGreaterThan(0);

    // The in-flight start must not repaint a disposed item.
    const paintsAtDisposal = item.shownCount;
    release();
    await settle();
    expect(item.shownCount).toBe(paintsAtDisposal);
    expect(unhandled).toEqual([]);
  });

  it('cancels a pending config restart when deactivated', async () => {
    vi.useFakeTimers();
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    expect(lc.FakeLanguageClient.instances).toHaveLength(1);

    fakeVscode.__fireConfigChange('openplanetLsp.gameTarget');
    await ext.deactivate();
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();

    expect(lc.FakeLanguageClient.instances).toHaveLength(1);
    expect(unhandled).toEqual([]);
  });

  it('ignores an old start rejection after deactivate and a successful reactivation', async () => {
    let releaseOldStart: () => void = () => {};
    lc.FakeLanguageClient.startGate = new Promise<void>((resolve) => {
      releaseOldStart = resolve;
    });
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    await ext.deactivate();

    lc.FakeLanguageClient.startGate = undefined;
    ext.activate(makeContext() as never);
    await settle();
    const reactivatedItem = statusItem();
    expect(reactivatedItem.tooltip).toContain('ready');

    lc.FakeLanguageClient.nextStartError = new Error('old start should not replace the new status');
    releaseOldStart();
    await settle();

    expect(reactivatedItem.tooltip).toContain('ready');
    expect(reactivatedItem.tooltip).not.toContain('old start should not replace the new status');
    expect(fakeVscode.recorded.errors).toEqual([]);
    expect(unhandled).toEqual([]);
    await ext.deactivate();
  });

  it('does not repaint a disposed item when a probe resolves late', async () => {
    let releaseVersion: (value: string) => void = () => {};
    let releaseDb: (value: { core: string; source: string }) => void = () => {};
    probes.probeServerVersion.mockImplementationOnce(
      () => new Promise<string>((resolve) => (releaseVersion = resolve)),
    );
    probes.probeTypeDb.mockImplementationOnce(
      () => new Promise((resolve) => (releaseDb = resolve)),
    );
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    const item = statusItem();
    await ext.deactivate();
    const paintsAtDisposal = item.shownCount;

    releaseVersion('too-late');
    releaseDb({ core: 'too-late', source: `${homedir()}/too-late` });
    await settle();

    expect(item.shownCount).toBe(paintsAtDisposal);
    expect(unhandled).toEqual([]);
  });

  it('leaves no state-change listener behind', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    const client = lc.FakeLanguageClient.instances[0];
    expect(client.stateListeners.length).toBeGreaterThan(0);
    await ext.deactivate();
    expect(client.stateListeners.length).toBe(0);
  });

  it('survives a deactivate with no activate', async () => {
    const ext = await loadExtension();
    await expect(ext.deactivate() ?? Promise.resolve()).resolves.not.toThrow();
  });
});

describe('status tooltip redaction choke point', () => {
  it('redacts a home path arriving in a field no test names by hand', async () => {
    // The probe result feeds serverVersion, which is not a "path field" and so
    // was not on the hand-maintained redaction list. Everything reaching the
    // tooltip must be redacted by default, not by remembering to list it.
    const probes = (await import('../src/serverProbe')) as unknown as {
      probeServerVersion: { mockResolvedValueOnce: (v: string) => void };
    };
    probes.probeServerVersion.mockResolvedValueOnce(`0.5.0 (built in ${homedir()}/build)`);

    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();

    expect(statusItem().tooltip).not.toContain(homedir());
    await ext.deactivate();
  });
});

/**
 * B050 wiring gate.
 *
 * The defines command tests drive `manageDefines` with a provider they
 * installed themselves, which proves the UI can USE one — not that the real
 * extension ever supplies one. That gap is exactly the failure B040 was filed
 * for: a handler that existed, was tested, and was never wired. So this
 * asserts the live path end to end — activate installs a provider, the
 * provider finds the running client, sends the right method, and parses what
 * comes back.
 */
describe('resolved-defines provider (B050)', () => {
  const ANSWER = {
    defines: [
      { name: 'TMNEXT', active: true, origin: 'target', derivedActive: true },
      { name: 'DEPENDENCY_MLHOOK', active: true, origin: 'dependency', derivedActive: true },
    ],
    gameTarget: 'TMNEXT',
    platformFamilies: [['TMNEXT'], ['MP4', 'MP40', 'MP41']],
  };

  /** The provider `activate()` most recently installed. */
  function provider() {
    const found = defines.installed.filter((p) => p !== undefined).at(-1);
    expect(found, 'activate() installed no resolved-defines provider').toBeDefined();
    return found!;
  }

  it('is installed by activate and cleared by deactivate', async () => {
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    expect(defines.installed.filter((p) => p !== undefined)).toHaveLength(1);
    await ext.deactivate();
    // It closes over `client` and `outputChannel`; leaving it installed would
    // outlive both.
    expect(defines.installed.at(-1)).toBeUndefined();
  });

  it('sends openplanet/resolvedDefines to the running client and parses the answer', async () => {
    lc.FakeLanguageClient.responses['openplanet/resolvedDefines'] = ANSWER;
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();

    const result = await provider()('file:///ws/my-plugin/src/Main.as');

    expect(lc.FakeLanguageClient.requests).toEqual([
      {
        method: 'openplanet/resolvedDefines',
        params: { uri: 'file:///ws/my-plugin/src/Main.as' },
      },
    ]);
    // The manifest-derived define reaches the UI with its origin intact —
    // the whole point of B050.
    expect(result).toEqual(ANSWER);
    await ext.deactivate();
  });

  it('degrades to undefined against a server without the method', async () => {
    // No canned response: the fake rejects, as a pre-B050 router does with
    // MethodNotFound. Manage Defines must still open.
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    await expect(provider()('file:///ws/my-plugin/src/Main.as')).resolves.toBeUndefined();
    await ext.deactivate();
  });

  it('does not send a request while the client is stopped', async () => {
    lc.FakeLanguageClient.responses['openplanet/resolvedDefines'] = ANSWER;
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    const ask = provider();
    await lc.FakeLanguageClient.instances.at(-1)!.stop();
    lc.FakeLanguageClient.requests = [];
    // `sendRequest` on a stopped client rejects; the state guard is what keeps
    // that off the happy path.
    await expect(ask('file:///ws/my-plugin/src/Main.as')).resolves.toBeUndefined();
    expect(lc.FakeLanguageClient.requests).toEqual([]);
    await ext.deactivate();
  });

  it('follows a restart instead of pinning the first client', async () => {
    lc.FakeLanguageClient.responses['openplanet/resolvedDefines'] = ANSWER;
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    const ask = provider();

    await run('openplanetLsp.restart');
    await settle();
    expect(lc.FakeLanguageClient.instances.length).toBeGreaterThan(1);

    lc.FakeLanguageClient.requests = [];
    await expect(ask('file:///ws/my-plugin/src/Main.as')).resolves.toEqual(ANSWER);
    // The SAME provider closure served the NEW client: it reads `client` at
    // call time rather than capturing an instance.
    expect(lc.FakeLanguageClient.requests).toHaveLength(1);
    await ext.deactivate();
  });
});

/**
 * B039: the palette route to `openplanet.regenerateTypeDb`.
 *
 * Before this the server advertised the command and nothing on the client
 * side could invoke it. Registration and the palette entry are separately
 * asserted above; what is here is what happens when a user actually runs it.
 */
describe('regenerate type database (B039)', () => {
  const SERVER_ANSWER = {
    ok: true,
    message: 'Type database reloaded (4274 entries)',
    regenerated: 4274,
    durationMs: 480,
    before: { op: '1.29.4 (next, Public, aaaaaaaa)', game_op: '1.29.4', mp: '2026-01-02 00:00:00' },
    after: { op: '1.29.5 (next, Public, 1234ad9e)', game_op: '1.29.5', mp: '2026-02-03 03:51:19' },
    changed: true,
  };

  async function activated(): Promise<typeof ext> {
    const extension = await loadExtension();
    extension.activate(makeContext() as never);
    await settle();
    return extension;
  }

  it('sends workspace/executeCommand for the advertised command name', async () => {
    lc.FakeLanguageClient.responses['workspace/executeCommand'] = SERVER_ANSWER;
    const extension = await activated();

    await run('openplanetLsp.regenerateTypeDb');

    expect(lc.FakeLanguageClient.requests).toEqual([
      {
        method: 'workspace/executeCommand',
        params: { command: 'openplanet.regenerateTypeDb', arguments: [] },
      },
    ]);
    await extension.deactivate();
  });

  it('runs under a progress notification, because regeneration is slow', async () => {
    lc.FakeLanguageClient.responses['workspace/executeCommand'] = SERVER_ANSWER;
    const extension = await activated();

    await run('openplanetLsp.regenerateTypeDb');

    expect(fakeVscode.recorded.progress).toHaveLength(1);
    const [call] = fakeVscode.recorded.progress;
    expect(call.options.location).toBe(fakeVscode.ProgressLocation.Notification);
    expect(call.options.title).toMatch(/type database/i);
    // A progress notification that never resolves is a permanent spinner.
    expect(call.settled).toBe(true);
    await extension.deactivate();
  });

  it('reports the versions that changed, not a bare "done"', async () => {
    lc.FakeLanguageClient.responses['workspace/executeCommand'] = SERVER_ANSWER;
    const extension = await activated();

    await run('openplanetLsp.regenerateTypeDb');

    expect(fakeVscode.recorded.infos).toHaveLength(1);
    const [message] = fakeVscode.recorded.infos;
    expect(message).toContain('1.29.4');
    expect(message).toContain('1.29.5');
    expect(fakeVscode.recorded.errors).toEqual([]);
    await extension.deactivate();
  });

  it('refreshes the status bar stamps, which are now a version behind', async () => {
    lc.FakeLanguageClient.responses['workspace/executeCommand'] = SERVER_ANSWER;
    const extension = await activated();

    await run('openplanetLsp.regenerateTypeDb');

    // The start-time probe reported 1.29.5/1.29.5 in beforeEach; the point
    // here is that the tooltip follows the COMMAND, not only that probe.
    expect(statusItem().tooltip).toContain('1.29.5 (next, Public, 1234ad9e)');
    await extension.deactivate();
  });

  it('surfaces a server-side failure instead of claiming success', async () => {
    lc.FakeLanguageClient.responses['workspace/executeCommand'] = {
      ok: false,
      message: 'type database paths not configured (set openplanet_dir or core_json/game_json)',
    };
    const extension = await activated();

    await run('openplanetLsp.regenerateTypeDb');

    expect(fakeVscode.recorded.infos).toEqual([]);
    expect(fakeVscode.recorded.errors).toHaveLength(1);
    expect(fakeVscode.recorded.errors[0]).toContain('not configured');
    // And the error offers the log, like every other failure path here.
    expect(fakeVscode.recorded.messages.at(-1)!.items).toContain('Show Logs');
    await extension.deactivate();
  });

  it('surfaces a rejected request — an older server answers InvalidParams', async () => {
    // No canned response: the fake rejects, as a pre-B039 router does for an
    // unknown command.
    const extension = await activated();

    await run('openplanetLsp.regenerateTypeDb');

    expect(fakeVscode.recorded.infos).toEqual([]);
    expect(fakeVscode.recorded.errors).toHaveLength(1);
    expect(fakeVscode.recorded.errors[0]).toMatch(/failed/i);
    await extension.deactivate();
  });

  it('surfaces an answer it cannot parse rather than reporting success', async () => {
    lc.FakeLanguageClient.responses['workspace/executeCommand'] = { done: true };
    const extension = await activated();

    await run('openplanetLsp.regenerateTypeDb');

    expect(fakeVscode.recorded.infos).toEqual([]);
    expect(fakeVscode.recorded.errors).toHaveLength(1);
    await extension.deactivate();
  });

  it('tells the user the server is not running instead of sending nothing', async () => {
    lc.FakeLanguageClient.responses['workspace/executeCommand'] = SERVER_ANSWER;
    const extension = await activated();
    await lc.FakeLanguageClient.instances.at(-1)!.stop();
    lc.FakeLanguageClient.requests = [];

    await run('openplanetLsp.regenerateTypeDb');

    expect(lc.FakeLanguageClient.requests).toEqual([]);
    expect(fakeVscode.recorded.errors).toHaveLength(1);
    expect(fakeVscode.recorded.errors[0]).toMatch(/not running/);
    await extension.deactivate();
  });

  it('follows a restart rather than pinning the first client', async () => {
    lc.FakeLanguageClient.responses['workspace/executeCommand'] = SERVER_ANSWER;
    const extension = await activated();

    await run('openplanetLsp.restart');
    await settle();
    expect(lc.FakeLanguageClient.instances.length).toBeGreaterThan(1);
    lc.FakeLanguageClient.requests = [];

    await run('openplanetLsp.regenerateTypeDb');

    expect(lc.FakeLanguageClient.requests).toHaveLength(1);
    await extension.deactivate();
  });
});
