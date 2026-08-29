/**
 * One-shot probes of the server binary (B043).
 *
 * The server does NOT report its own version or its type DB version over LSP:
 * `InitializeResult.serverInfo` is left at its default (see
 * `src/server/mod.rs` in the server repo), so there is no in-protocol channel
 * for either. Both come from short-lived child processes run once per server
 * start instead.
 *
 * "Once per start" is the whole contract — the status bar must not poll, and
 * these two spawns are the only ones it does. Parsing is split out from
 * spawning so the wire formats can be tested without a binary.
 */

import { execFile } from 'node:child_process';

/** Give up rather than hang the status bar on a wedged or wrong binary. */
export const PROBE_TIMEOUT_MS = 5_000;

export interface TypeDbProbe {
  /** Openplanet version stamp of the core DB, e.g. "1.29.5 (next, Public, ...)". */
  core?: string;
  /** Openplanet version stamp of the game DB. */
  game?: string;
  /** Directory both DBs were read from. NOT home-abbreviated here. */
  source?: string;
}

/**
 * Parse `openplanet-lsp --version`.
 *
 * Canonical form is "openplanet-lsp 0.4.1". Tolerates a `v` prefix and a
 * build suffix, and returns undefined rather than garbage when the output
 * came from some other binary entirely.
 */
export function parseVersion(output: string): string | undefined {
  const trimmed = output.trim();
  if (trimmed === '') return undefined;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return undefined;
  const raw = parts[1].startsWith('v') ? parts[1].slice(1) : parts[1];
  return /^\d+\.\d+/.test(raw) ? raw : undefined;
}

/** Strip the filename off a path without importing `path` (works for both separators). */
function dirnameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx > 0 ? p.slice(0, idx) : p;
}

/**
 * Parse `openplanet-lsp typedb status --json`:
 *
 *   { "core": { "op": "1.29.5 (...)", "path": "..." },
 *     "game": { "op": "1.29.5", "mp": "...", "path": "..." } }
 *
 * Returns undefined when the text is not that JSON, so the caller can fall
 * back to the human-readable parser for older server builds.
 */
export function parseTypeDbJson(output: string): TypeDbProbe | undefined {
  const start = output.indexOf('{');
  if (start < 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.slice(start));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;

  const root = parsed as Record<string, unknown>;
  const section = (key: string): Record<string, unknown> | undefined => {
    const v = root[key];
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
  };
  const str = (o: Record<string, unknown> | undefined, key: string): string | undefined => {
    const v = o?.[key];
    return typeof v === 'string' && v.trim() !== '' ? v : undefined;
  };

  const core = section('core');
  const game = section('game');
  if (core === undefined && game === undefined) return undefined;

  const path = str(core, 'path') ?? str(game, 'path');
  return {
    core: str(core, 'op'),
    game: str(game, 'op'),
    source: path ? dirnameOf(path) : undefined,
  };
}

/**
 * Parse the human-readable `openplanet-lsp typedb status` output:
 *
 *   core:  /home/u/OpenplanetNext/OpenplanetCore.json  op=1.29.5 (next, ...)  [...]
 *   game:  /home/u/OpenplanetNext/OpenplanetNext.json  op=1.29.5  mp=...
 *
 * Only a fallback for builds without `--json`. Unparseable input yields
 * undefined fields rather than a throw — a missing type DB is something the
 * status bar should be able to SAY, not a reason to have no status bar.
 */
export function parseTypeDbText(output: string): TypeDbProbe {
  const probe: TypeDbProbe = {};
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*(core|game):\s+(\S+)\s+op=(\S+)/.exec(line);
    if (!m) continue;
    const [, which, path, version] = m;
    if (which === 'core') probe.core = version;
    else probe.game = version;
    probe.source ??= dirnameOf(path);
  }
  return probe;
}

/**
 * Run a binary, resolving to its combined output, or undefined when it could
 * not be run at all. A non-zero exit is NOT a failure here: the CLI prints
 * the type DB banner even when a DB is missing, and that is exactly the case
 * the status bar exists to show.
 */
function run(bin: string, args: readonly string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      execFile(
        bin,
        [...args],
        { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
        (err, stdout, stderr) => {
          const out = `${stdout ?? ''}${stderr ?? ''}`;
          if (out.trim() === '' && err) {
            resolve(undefined);
            return;
          }
          resolve(out);
        },
      );
    } catch {
      // execFile can throw synchronously on a malformed command.
      resolve(undefined);
    }
  });
}

/** `<bin> --version`, or undefined when the binary cannot be run. */
export async function probeServerVersion(bin: string): Promise<string | undefined> {
  const out = await run(bin, ['--version']);
  return out === undefined ? undefined : parseVersion(out);
}

/**
 * `<bin> typedb status --json`, falling back to the text format.
 * Returns undefined when the binary cannot be run at all.
 */
export async function probeTypeDb(bin: string): Promise<TypeDbProbe | undefined> {
  const out = await run(bin, ['typedb', 'status', '--json']);
  if (out === undefined) return undefined;
  return parseTypeDbJson(out) ?? parseTypeDbText(out);
}
