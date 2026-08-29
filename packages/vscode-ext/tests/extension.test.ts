import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as fakeVscode from './mocks/vscode';
import * as ext from '../src/extension';

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
    }
  }

  return { State, FakeLanguageClient };
});

vi.mock('vscode-languageclient/node', () => ({
  LanguageClient: lc.FakeLanguageClient,
  State: lc.State,
  TransportKind: { stdio: 'stdio' },
}));

// The probes spawn a real binary; in tests there is none, and a spawn per
// activation would make the suite slow and machine-dependent.
vi.mock('../src/serverProbe', () => ({
  probeServerVersion: vi.fn(async () => '9.9.9-probe'),
  probeTypeDb: vi.fn(async () => ({
    core: '1.29.5',
    game: '1.29.5',
    source: `${homedir()}/OpenplanetNext`,
  })),
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
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  fakeVscode.__setWorkspaceFolders([`${homedir()}/src/my-plugin`]);
  fakeVscode.__setActiveEditor(`${homedir()}/src/my-plugin/src/Main.as`);
});

afterEach(() => {
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

  it('does NOT contribute regenerateTypeDb', () => {
    // B039 owns that command and its server-side half; contributing it here
    // would put a palette entry in front of unverified server behaviour.
    const ids = pkg.contributes.commands.map((c) => c.command);
    expect(ids).not.toContain('openplanetLsp.regenerateTypeDb');
    expect(ids).not.toContain('openplanet.regenerateTypeDb');
  });

  it('declares explicit activation events', () => {
    expect(pkg.activationEvents.length).toBeGreaterThan(0);
    expect(pkg.activationEvents).toContain('onLanguage:angelscript');
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

  it('names the missing serverPath override and still reaches a clean state', async () => {
    fakeVscode.__setConfig({ 'openplanetLsp.serverPath': '/no/such/openplanet-lsp' });
    lc.FakeLanguageClient.nextStartError = new Error('spawn openplanet-lsp ENOENT');
    const ext = await loadExtension();
    ext.activate(makeContext() as never);
    await settle();
    expect(fakeVscode.recorded.warnings.join('\n')).toContain('/no/such/openplanet-lsp');
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
