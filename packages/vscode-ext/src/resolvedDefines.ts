/**
 * The `openplanet/resolvedDefines` request (B050).
 *
 * Pure (no `vscode`, no `vscode-languageclient`) so it is unit-testable,
 * mirroring `defines.ts`, `settings.ts` and `paths.ts`.
 *
 * ## Why a request and not a command
 *
 * Reading the effective define set is a QUERY. `executeCommand` returns
 * `unknown | null` and would have to be re-validated at every call site
 * anyway; a custom request gets one typed shape and one validator — this
 * file.
 *
 * ## Why the answer is never trusted blindly
 *
 * It arrives over JSON-RPC from a binary the user chose (`openplanetLsp.
 * serverPath` can point at any build, and the bundled binary can be older
 * than the extension). So {@link parseResolvedDefines} validates the payload
 * structurally and returns `undefined` rather than throwing: a stale server
 * that answers `MethodNotFound`, or answers something unexpected, must leave
 * the defines UI working in its B034 degraded mode, not break it.
 *
 * A missing answer is therefore not an error condition — it is the older of
 * the two supported states, and the UI says which one it is in.
 */

import type { DefineOrigin, ResolvedDefine } from './defines';

/** The server method. Mirrors `RESOLVED_DEFINES` in the server's `server/mod.rs`. */
export const RESOLVED_DEFINES_METHOD = 'openplanet/resolvedDefines';

/**
 * Origins this client knows how to describe. A server newer than the
 * extension may name one that is not here; {@link parseResolvedDefines} maps
 * those to `unknown` rather than dropping the row, because a define whose
 * origin cannot be labelled is still a define the user needs to see.
 */
const KNOWN_ORIGINS: readonly DefineOrigin[] = [
  'target',
  'signature',
  'os',
  'arch',
  'build',
  'manifest',
  'dependency',
  'dependency-missing',
  'user',
  'unknown',
];

/** A validated `openplanet/resolvedDefines` answer. */
export interface ResolvedDefinesResult {
  /** The effective set, in the server's order (origin class, then name). */
  defines: ResolvedDefine[];
  /** The resolved game target — the server's, not the VS Code setting's. */
  gameTarget: string;
  /**
   * The ManiaPlanet-generation families, straight from
   * `LspConfig::PLATFORM_FAMILIES`. Supersedes the fallback copy in
   * `settings.ts` whenever the server answers.
   */
  platformFamilies: string[][];
}

/**
 * The one thing this module needs from a `LanguageClient`, so tests (and this
 * module's types) never depend on `vscode-languageclient`.
 */
export interface DefinesRequestClient {
  sendRequest<R>(method: string, param: unknown): Promise<R>;
}

/** How the defines UI obtains a resolved set; injected by `extension.ts`. */
export type ResolvedDefinesProvider = (uri?: string) => Promise<ResolvedDefinesResult | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseOrigin(value: unknown): DefineOrigin {
  return typeof value === 'string' && (KNOWN_ORIGINS as readonly string[]).includes(value)
    ? (value as DefineOrigin)
    : 'unknown';
}

function parseDefine(value: unknown): ResolvedDefine | undefined {
  if (!isRecord(value)) return undefined;
  const { name, active, origin, derivedActive } = value;
  // A row with no name or no effective state cannot be rendered or edited;
  // anything else is recoverable.
  if (typeof name !== 'string' || name === '' || typeof active !== 'boolean') return undefined;
  return {
    name,
    active,
    origin: parseOrigin(origin),
    derivedActive: typeof derivedActive === 'boolean' ? derivedActive : undefined,
  };
}

/**
 * Validate a raw `openplanet/resolvedDefines` payload.
 *
 * Returns `undefined` when the answer is not usable at all. Individual
 * malformed ROWS are dropped rather than failing the whole answer: a partial
 * derived set is still strictly better than the user's array alone, which is
 * all B034 could show.
 */
export function parseResolvedDefines(payload: unknown): ResolvedDefinesResult | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.defines)) return undefined;
  const defines = payload.defines
    .map(parseDefine)
    .filter((d): d is ResolvedDefine => d !== undefined);
  const families = Array.isArray(payload.platformFamilies)
    ? payload.platformFamilies
        .filter((family): family is unknown[] => Array.isArray(family))
        .map((family) => family.filter((name): name is string => typeof name === 'string'))
        .filter((family) => family.length > 0)
    : [];
  return {
    defines,
    gameTarget: typeof payload.gameTarget === 'string' ? payload.gameTarget : '',
    platformFamilies: families,
  };
}

/**
 * Ask the server for the resolved define set.
 *
 * `uri` scopes the answer to one plugin workspace — a multi-root window
 * serves one config PER root, so a window-wide answer would be right for at
 * most one of them.
 *
 * Never rejects. Every failure (no client, a server without the method, a
 * malformed payload) becomes `undefined` plus a log line, because the caller's
 * only sensible response to all of them is the same: fall back to the B034
 * behaviour and say so.
 */
export async function requestResolvedDefines(
  client: DefinesRequestClient | undefined,
  uri?: string,
  log?: (message: string) => void,
): Promise<ResolvedDefinesResult | undefined> {
  if (!client) {
    log?.('[defines] no language server running; showing overrides only');
    return undefined;
  }
  try {
    const raw = await client.sendRequest<unknown>(RESOLVED_DEFINES_METHOD, { uri });
    const parsed = parseResolvedDefines(raw);
    if (!parsed) {
      log?.(`[defines] ${RESOLVED_DEFINES_METHOD} returned an unusable payload`);
      return undefined;
    }
    log?.(`[defines] server reported ${parsed.defines.length} resolved define(s)`);
    return parsed;
  } catch (err) {
    // Expected against any server predating B050: the router answers
    // MethodNotFound and vscode-languageclient turns that into a rejection.
    const detail = err instanceof Error ? err.message : String(err);
    log?.(`[defines] ${RESOLVED_DEFINES_METHOD} unavailable (${detail}); showing overrides only`);
    return undefined;
  }
}
