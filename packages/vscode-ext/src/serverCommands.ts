/**
 * The `workspace/executeCommand` surface the SERVER offers (B039).
 *
 * Pure (no `vscode`, no `vscode-languageclient`) so it is unit-testable,
 * mirroring `resolvedDefines.ts`, `defines.ts`, `settings.ts` and `paths.ts`.
 *
 * ## Why this file exists at all
 *
 * B039: the server advertised `openplanet.regenerateTypeDb` in its
 * `ExecuteCommandOptions` and no client could reach it — no palette entry, no
 * `executeCommand` call anywhere in this extension. A capability nothing can
 * invoke is, to a user, a capability that does not exist.
 *
 * ## Why a command and not a request
 *
 * The mirror-image of the reasoning in `resolvedDefines.ts`. Reading the
 * define set is a QUERY, so it is a custom request. Regenerating the type
 * database MUTATES server state, which is what `workspace/executeCommand` is
 * for, and the server's advertised command list is the contract that says so.
 *
 * ## Why failure is loud here
 *
 * Also unlike `resolvedDefines.ts`. A missing define set has a sensible
 * degraded mode (show the user's own overrides and say so). A failed
 * regeneration does not: the user asked for this explicitly, usually because
 * their symbols are already stale, and silently leaving the old database
 * loaded while showing nothing is the worst of both. So every failure path
 * here produces a message the caller must show.
 */

/**
 * Command ids the server advertises in `ExecuteCommandOptions.commands`.
 *
 * Mirrors `ADVERTISED` in the server's `src/server/commands.rs`, which is
 * gated there by `tests/execute_command_tests.rs` (every advertised command
 * must be dispatched). This is the ONLY set of server-directed command ids in
 * the extension — see the audit test in `tests/serverCommands.test.ts`, which
 * fails if any other module sends a `workspace/executeCommand`.
 */
export const SERVER_COMMANDS = {
  regenerateTypeDb: 'openplanet.regenerateTypeDb',
} as const;

export type ServerCommandId = (typeof SERVER_COMMANDS)[keyof typeof SERVER_COMMANDS];

/** The LSP method. Equal to `ExecuteCommandRequest.type.method`. */
export const EXECUTE_COMMAND_METHOD = 'workspace/executeCommand';

/**
 * The one thing this module needs from a `LanguageClient`, so tests (and this
 * module's types) never depend on `vscode-languageclient`.
 */
export interface ExecuteCommandClient {
  sendRequest<R>(method: string, param: unknown): Promise<R>;
}

/**
 * Type-database build stamps, as `TypeDbVersions::to_json` sends them.
 *
 * The server's key names are kept (`op` / `game_op` / `mp`) at the wire and
 * renamed here to the words the rest of this extension already uses for the
 * same three values (`serverProbe.ts`, `statusReport.ts`).
 */
export interface TypeDbStamps {
  /** Openplanet Core build, e.g. `1.29.5 (next, Public, 1234ad9e)`. */
  core?: string;
  /** Game database version, e.g. `1.29.5`. */
  game?: string;
  /** When the game database was dumped, e.g. `2026-02-03 03:51:19`. */
  dumped?: string;
}

/** A validated `openplanet.regenerateTypeDb` answer. */
export interface RegenerateTypeDbResult {
  /** Did the server actually load a database? */
  ok: boolean;
  /** The server's own sentence. Always present; shown verbatim on failure. */
  message: string;
  /** Symbols loaded (types + functions + enums). */
  regenerated?: number;
  durationMs?: number;
  /** Stamps of the database the server HAD loaded; absent if it had none. */
  before?: TypeDbStamps;
  /** Stamps of what is on disk now. Absent when nothing was loaded. */
  after?: TypeDbStamps;
  /** The server's own comparison of the two. */
  changed?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function parseStamps(value: unknown): TypeDbStamps | undefined {
  if (!isRecord(value)) return undefined;
  const stamps: TypeDbStamps = {
    core: str(value.op),
    game: str(value.game_op),
    dumped: str(value.mp),
  };
  // An object with no readable stamp at all is not worth reporting as one.
  return stamps.core || stamps.game || stamps.dumped ? stamps : undefined;
}

/**
 * Validate a raw `openplanet.regenerateTypeDb` payload.
 *
 * Returns `undefined` when the answer is not usable, rather than throwing:
 * the payload arrives from a binary the user chose (`openplanetLsp.
 * serverPath` can point at any build, and the bundled binary can be older
 * than the extension), so an unrecognisable answer is an expected state, not
 * an exception. The caller turns it into a visible error either way.
 */
export function parseRegenerateTypeDb(payload: unknown): RegenerateTypeDbResult | undefined {
  if (!isRecord(payload) || typeof payload.ok !== 'boolean') return undefined;
  return {
    ok: payload.ok,
    message:
      str(payload.message) ?? (payload.ok ? 'Type database reloaded' : 'Regeneration failed'),
    regenerated: typeof payload.regenerated === 'number' ? payload.regenerated : undefined,
    durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
    before: parseStamps(payload.before),
    after: parseStamps(payload.after),
    changed: typeof payload.changed === 'boolean' ? payload.changed : undefined,
  };
}

function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** `label: old -> new` for each stamp that moved. */
function changedStamps(before: TypeDbStamps, after: TypeDbStamps): string[] {
  const fields: [keyof TypeDbStamps, string][] = [
    ['core', 'Openplanet'],
    ['game', 'game'],
    ['dumped', 'dumped'],
  ];
  return fields
    .filter(([key]) => before[key] !== after[key])
    .map(([key, label]) => `${label} ${before[key] ?? 'none'} → ${after[key] ?? 'none'}`);
}

/** `label X` for each stamp present. */
function listStamps(stamps: TypeDbStamps): string[] {
  return [
    stamps.core === undefined ? undefined : `Openplanet ${stamps.core}`,
    stamps.game === undefined ? undefined : `game ${stamps.game}`,
    stamps.dumped === undefined ? undefined : `dumped ${stamps.dumped}`,
  ].filter((part): part is string => part !== undefined);
}

/**
 * The sentence the user sees.
 *
 * Deliberately never a bare "done". Regeneration is what a user reaches for
 * when they suspect the symbol surface is stale, and the answer they need is
 * whether anything actually moved — an unchanged reload is a completely
 * different outcome from a version bump and looks identical without this.
 */
export function describeRegenerateTypeDb(result: RegenerateTypeDbResult): string {
  if (!result.ok) return result.message;

  const size = result.regenerated === undefined ? undefined : `${result.regenerated} symbols`;
  const took = formatDuration(result.durationMs);
  const tail = [size, took].filter((part) => part !== undefined).join(', ');
  const suffix = tail === '' ? '' : ` (${tail})`;

  const { before, after } = result;
  if (after === undefined) return `Type database reloaded${suffix}.`;
  if (before === undefined) {
    return `Type database loaded: ${listStamps(after).join(', ')}${suffix}.`;
  }
  const moved = changedStamps(before, after);
  if (moved.length === 0) {
    return `Type database reloaded, versions unchanged: ${listStamps(after).join(', ')}${suffix}.`;
  }
  return `Type database updated: ${moved.join(', ')}${suffix}.`;
}

/**
 * Ask the server to regenerate its type database.
 *
 * REJECTS on every failure the caller cannot render as an outcome: no client,
 * a transport error, a server that does not know the command (an older build
 * answers `InvalidParams`), or an answer that does not parse. A server that
 * ran and failed comes back as `ok: false` with the server's own reason — a
 * result, not a rejection, because the reason is worth showing verbatim.
 */
export async function requestRegenerateTypeDb(
  client: ExecuteCommandClient | undefined,
  log?: (message: string) => void,
): Promise<RegenerateTypeDbResult> {
  if (!client) {
    throw new Error('the Openplanet LSP server is not running');
  }
  log?.(`[typedb] sending ${SERVER_COMMANDS.regenerateTypeDb}`);
  const raw = await client.sendRequest<unknown>(EXECUTE_COMMAND_METHOD, {
    command: SERVER_COMMANDS.regenerateTypeDb,
    arguments: [],
  });
  const parsed = parseRegenerateTypeDb(raw);
  if (!parsed) {
    log?.(`[typedb] unusable answer: ${JSON.stringify(raw)}`);
    throw new Error(
      `the server answered ${SERVER_COMMANDS.regenerateTypeDb} with something this ` +
        'extension does not understand (is the server older than the extension?)',
    );
  }
  log?.(`[typedb] ${describeRegenerateTypeDb(parsed)}`);
  return parsed;
}
