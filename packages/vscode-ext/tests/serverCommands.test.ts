import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecuteCommandParams } from 'vscode-languageclient';

import {
  describeRegenerateTypeDb,
  EXECUTE_COMMAND_METHOD,
  parseRegenerateTypeDb,
  requestRegenerateTypeDb,
  SERVER_COMMANDS,
  type ExecuteCommandClient,
  type RegenerateTypeDbResult,
} from '../src/serverCommands';

/**
 * B039: the client half of `openplanet.regenerateTypeDb`.
 *
 * Pure tests — no `vscode`, no extension host. The activation-level wiring
 * (registration, palette entry, progress, error notification) is in
 * extension.test.ts; what is checked here is the payload contract with the
 * server and the sentence the user ends up reading.
 */

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A server answer with everything populated, as `regenerate_type_db` sends it. */
const FULL = {
  ok: true,
  message: 'Type database reloaded (4274 entries)',
  regenerated: 4274,
  durationMs: 480,
  before: { op: '1.29.4 (next, Public, aaaaaaaa)', game_op: '1.29.4', mp: '2026-01-02 00:00:00' },
  after: { op: '1.29.5 (next, Public, 1234ad9e)', game_op: '1.29.5', mp: '2026-02-03 03:51:19' },
  changed: true,
};

function clientAnswering(answer: unknown): ExecuteCommandClient & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    sendRequest: <R>(method: string, param: unknown): Promise<R> => {
      sent.push({ method, param });
      return Promise.resolve(answer as R);
    },
  };
}

describe('the wire contract', () => {
  it('uses the spec method name', () => {
    // Hand-typed because the module stays free of `vscode-languageclient`
    // (see its header). A typo here would ship as a request no server
    // answers, so it gets its own assertion rather than living only inside
    // the round-trip test below.
    expect(EXECUTE_COMMAND_METHOD).toBe('workspace/executeCommand');
  });

  it('builds params the protocol types accept', () => {
    // Type-only import: erased at runtime, but `just typecheck` fails if
    // `ExecuteCommandParams` ever stops matching what we send.
    const params: ExecuteCommandParams = {
      command: SERVER_COMMANDS.regenerateTypeDb,
      arguments: [],
    };
    expect(params.command).toBe('openplanet.regenerateTypeDb');
  });
});

describe('parseRegenerateTypeDb', () => {
  it('reads a full answer, renaming the wire stamps to this extension words', () => {
    expect(parseRegenerateTypeDb(FULL)).toEqual({
      ok: true,
      message: 'Type database reloaded (4274 entries)',
      regenerated: 4274,
      durationMs: 480,
      before: {
        core: '1.29.4 (next, Public, aaaaaaaa)',
        game: '1.29.4',
        dumped: '2026-01-02 00:00:00',
      },
      after: {
        core: '1.29.5 (next, Public, 1234ad9e)',
        game: '1.29.5',
        dumped: '2026-02-03 03:51:19',
      },
      changed: true,
    } satisfies RegenerateTypeDbResult);
  });

  it('keeps a failure answer, which carries no stamps', () => {
    expect(
      parseRegenerateTypeDb({ ok: false, message: 'type database paths not configured' }),
    ).toEqual({
      ok: false,
      message: 'type database paths not configured',
      regenerated: undefined,
      durationMs: undefined,
      before: undefined,
      after: undefined,
      changed: undefined,
    });
  });

  it('survives a server that loaded a database it had none of before', () => {
    const parsed = parseRegenerateTypeDb({ ...FULL, before: null });
    expect(parsed?.before).toBeUndefined();
    expect(parsed?.after?.game).toBe('1.29.5');
  });

  it('drops stamp objects with nothing readable in them', () => {
    // `TypeDbVersions::to_json` emits nulls when a probe found no stamp; an
    // all-null object is not a version and must not be rendered as one.
    expect(
      parseRegenerateTypeDb({ ...FULL, after: { op: null, game_op: null, mp: null } })?.after,
    ).toBeUndefined();
  });

  it.each([
    ['not an object', 42],
    ['null', null],
    ['no ok field', { message: 'hi' }],
    ['ok is not a boolean', { ok: 'yes', message: 'hi' }],
  ])('rejects %s', (_name, payload) => {
    expect(parseRegenerateTypeDb(payload)).toBeUndefined();
  });

  it('substitutes a message when the server omits one', () => {
    expect(parseRegenerateTypeDb({ ok: true })?.message.length).toBeGreaterThan(0);
    expect(parseRegenerateTypeDb({ ok: false })?.message.length).toBeGreaterThan(0);
  });
});

describe('describeRegenerateTypeDb', () => {
  const describeOf = (payload: unknown): string =>
    describeRegenerateTypeDb(parseRegenerateTypeDb(payload)!);

  it('names every stamp that moved, old and new', () => {
    const text = describeOf(FULL);
    expect(text).toContain(
      'Openplanet 1.29.4 (next, Public, aaaaaaaa) → 1.29.5 (next, Public, 1234ad9e)',
    );
    expect(text).toContain('game 1.29.4 → 1.29.5');
    expect(text).toContain('dumped 2026-01-02 00:00:00 → 2026-02-03 03:51:19');
    expect(text).toContain('4274 symbols');
  });

  it('mentions only the stamps that actually moved', () => {
    const text = describeOf({
      ...FULL,
      before: { ...FULL.after, game_op: '1.29.4' },
    });
    expect(text).toContain('game 1.29.4 → 1.29.5');
    expect(text).not.toContain('Openplanet 1.29.5 (next, Public, 1234ad9e) →');
    expect(text).not.toContain('dumped 2026-02-03 03:51:19 →');
  });

  it('says plainly when nothing changed, which is the outcome a bare "done" hides', () => {
    const text = describeOf({ ...FULL, before: FULL.after, changed: false });
    expect(text).toContain('unchanged');
    expect(text).toContain('1.29.5');
    expect(text).not.toContain('→');
  });

  it('lists the versions when the server had none loaded before', () => {
    const text = describeOf({ ...FULL, before: null });
    expect(text).toContain('Openplanet 1.29.5 (next, Public, 1234ad9e)');
    expect(text).toContain('game 1.29.5');
    expect(text).not.toContain('→');
  });

  it('shows the server reason verbatim on failure, with no invented outcome', () => {
    const text = describeOf({ ok: false, message: 'type database paths not configured' });
    expect(text).toBe('type database paths not configured');
  });

  it('renders sub-second and multi-second runs differently', () => {
    expect(describeOf({ ...FULL, durationMs: 480 })).toContain('480ms');
    expect(describeOf({ ...FULL, durationMs: 4800 })).toContain('4.8s');
  });

  it('omits the size/time parenthetical when the server reported neither', () => {
    // Plain stamps: the real core stamp carries its own parentheses.
    const text = describeOf({
      ok: true,
      message: 'x',
      before: { game_op: '1.29.4' },
      after: { game_op: '1.29.5' },
    });
    expect(text).toBe('Type database updated: game 1.29.4 → 1.29.5.');
  });
});

describe('requestRegenerateTypeDb', () => {
  it('sends workspace/executeCommand with the advertised command name', async () => {
    const client = clientAnswering(FULL);
    await requestRegenerateTypeDb(client);
    expect(client.sent).toEqual([
      {
        method: 'workspace/executeCommand',
        param: { command: 'openplanet.regenerateTypeDb', arguments: [] },
      },
    ]);
  });

  it('logs what it sent and what came back', async () => {
    const log = vi.fn();
    await requestRegenerateTypeDb(clientAnswering(FULL), log);
    expect(log.mock.calls.flat().join('\n')).toContain('openplanet.regenerateTypeDb');
  });

  it('rejects when there is no running server, without inventing an outcome', async () => {
    await expect(requestRegenerateTypeDb(undefined)).rejects.toThrow(/not running/);
  });

  it('rejects when the server rejects — an older build answers InvalidParams', async () => {
    const client: ExecuteCommandClient = {
      sendRequest: () => Promise.reject(new Error('unknown command `openplanet.regenerateTypeDb`')),
    };
    await expect(requestRegenerateTypeDb(client)).rejects.toThrow(/unknown command/);
  });

  it('rejects an answer it cannot understand rather than reporting success', async () => {
    await expect(requestRegenerateTypeDb(clientAnswering(null))).rejects.toThrow(
      /does not understand/,
    );
    await expect(requestRegenerateTypeDb(clientAnswering({ done: true }))).rejects.toThrow(
      /does not understand/,
    );
  });

  it('returns a server-side failure as a result, so its reason can be shown', async () => {
    const result = await requestRegenerateTypeDb(
      clientAnswering({ ok: false, message: 'type database paths not configured' }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('type database paths not configured');
  });
});

/**
 * The inverse of B039's defect: a command the EXTENSION sends that the server
 * does not advertise. Both directions are unreachable capabilities; this one
 * fails at the user, with "command not found".
 */
describe('server-command audit', () => {
  const srcFiles = readdirSync(join(pkgRoot, 'src'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(join(pkgRoot, 'src', name), 'utf8') }));

  it('has exactly one module that sends workspace/executeCommand', () => {
    const senders = srcFiles
      .filter((f) => f.text.includes('workspace/executeCommand'))
      .map((f) => f.name);
    expect(senders).toEqual(['serverCommands.ts']);
  });

  it('sends no server command outside the advertised set', () => {
    const advertised = new Set<string>(Object.values(SERVER_COMMANDS));
    for (const file of srcFiles) {
      for (const [, id] of file.text.matchAll(/['"](openplanet\.[A-Za-z0-9_.]+)['"]/g)) {
        expect(
          advertised.has(id),
          `${file.name} names a server command the server does not advertise: ${id}`,
        ).toBe(true);
      }
    }
  });

  it('routes no server command through vscode.commands.executeCommand', () => {
    // That call runs a CLIENT command. Passing a server command id to it
    // fails with "command not found" and never reaches the server.
    for (const file of srcFiles) {
      for (const [, id] of file.text.matchAll(/commands\.executeCommand\(\s*['"]([^'"]+)['"]/g)) {
        expect(id.startsWith('openplanet.'), `${file.name}: ${id}`).toBe(false);
      }
    }
  });
});
