/**
 * `openplanetLsp.defines` edit-list logic (B034).
 *
 * Pure functions (no `vscode` import) so they are unit-testable, mirroring
 * `settings.ts` and `paths.ts`.
 *
 * ## What the array actually is
 *
 * `openplanetLsp.defines` is not a define list — it is a tri-state EDIT LIST
 * over a base set the server derives (game target, signature level, OS/arch,
 * build shape, `info.toml` `[script].defines` and resolved dependencies). The
 * server applies it last, in `LspConfig::apply_define_overrides` (B024):
 *
 *   - each entry is trimmed;
 *   - a single leading `-` or `!` marks it a REMOVE, and the rest is trimmed
 *     again;
 *   - an entry that is empty after that is dropped;
 *   - every add is applied first and every remove second, so a REMOVE WINS
 *     over an add of the same name wherever the two sit in the array;
 *   - names go into a `HashSet<String>` and are compared byte-for-byte.
 *
 * Two consequences are load-bearing for this module and are pinned by tests:
 *
 * 1. **Case is significant and preserved.** `dev` and `DEV` are different
 *    defines to the server, so the UI never upcases what the user typed —
 *    doing so would make a name entered through the palette behave
 *    differently from the same name typed into settings.json.
 * 2. **A contradictory array resolves to OFF**, not to "last one wins".
 *
 * ## What this module deliberately does NOT do
 *
 * It never derives the base set. No server request exposes the resolved
 * defines today, and re-deriving them here would duplicate the config ladder
 * (B017) and the manifest/dependency rules (B019) in a second place that
 * would drift. Where the derived state is unknown, `derivedOn` is left
 * `undefined` and an explicit entry is written instead of a minimal one.
 * When a `openplanet-lsp/resolvedDefines`-style request lands, feeding its
 * answer to {@link buildDefineRows} is the whole integration.
 */

/** Prefixes the server accepts to turn a define OFF. */
export const NEGATION_PREFIXES = ['-', '!'] as const;

/** The one this module writes. `!` is an accepted alias, not a second form. */
export const CANONICAL_NEGATION = '-';

/** A valid AngelScript preprocessor identifier — the only thing `#if` can name. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Characters Openplanet maps to `_` when turning a plugin id into a
 * `DEPENDENCY_*` macro (docs, "Plugin Dependencies"). Used only to suggest a
 * fix — this module never rewrites a name on the user's behalf.
 */
const OPENPLANET_MAPPED = /[ \-.]/g;

/** Where a define came from, under the B017 config ladder. */
export type DefineOrigin =
  | 'target'
  | 'signature'
  | 'os'
  | 'arch'
  | 'build'
  | 'manifest'
  | 'dependency'
  | 'dependency-missing'
  | 'user'
  | 'unknown';

/** One entry of `openplanetLsp.defines`, as the server reads it. */
export interface ParsedEntry {
  /** The array element verbatim, so it can be removed by identity. */
  raw: string;
  /** Name after trimming and stripping at most one negation prefix. */
  name: string;
  /** `false` when the entry turns the define off. */
  on: boolean;
}

/** A wanted state for one define, as produced by the manage QuickPick. */
export interface DefineEdit {
  name: string;
  on: boolean;
  /**
   * The state this define would have with NO user override. When it is known
   * and already equal to `on`, the override is REMOVED instead of a redundant
   * entry being written. `undefined` = unknown, so an explicit entry is used.
   */
  derivedOn?: boolean;
}

/** One define as a future server introspection request would report it. */
export interface ResolvedDefine {
  name: string;
  /** Effective state, overrides included. */
  active: boolean;
  origin: DefineOrigin;
  /** State without the user's `defines` entries; `undefined` when unreported. */
  derivedActive?: boolean;
}

/** One row of the manage QuickPick. */
export interface DefineRow {
  name: string;
  active: boolean;
  origin: DefineOrigin;
  /** See {@link DefineEdit.derivedOn}. */
  derivedOn?: boolean;
  /** The user's own array entry for this define, when there is one. */
  entry?: string;
}

export type ValidationSeverity = 'error' | 'warning';

export interface DefineNameIssue {
  severity: ValidationSeverity;
  message: string;
}

/** Which settings scope an edit is written to. */
export type DefinesScope = 'workspace' | 'user';

/** The subset of `WorkspaceConfiguration.inspect()` this module needs. */
export interface InspectedDefines {
  globalValue?: readonly string[];
  workspaceValue?: readonly string[];
}

/** What `clearOverrides` should write. */
export type ClearPlan = { action: 'noop' } | { action: 'unset' } | { action: 'empty' };

/**
 * Read one array entry the way the server does, or `undefined` when the
 * server would drop it (empty, whitespace, a bare prefix).
 */
export function parseDefineEntry(raw: string): ParsedEntry | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const negated = (NEGATION_PREFIXES as readonly string[]).includes(trimmed[0]);
  // Exactly one prefix is stripped, matching `strip_prefix(['-', '!'])`:
  // `--LOGS` removes a define literally named `-LOGS`.
  const name = (negated ? trimmed.slice(1) : trimmed).trim();
  if (name === '') return undefined;
  return { raw, name, on: !negated };
}

/** Parse a whole array, keeping order and skipping the entries the server drops. */
export function parseDefineEntries(entries: readonly string[]): ParsedEntry[] {
  return entries.map(parseDefineEntry).filter((e): e is ParsedEntry => e !== undefined);
}

/**
 * Effective override state per define name.
 *
 * Removals are applied after additions server-side, so a name present in both
 * buckets is OFF — the deterministic answer for a contradictory array.
 */
export function overrideStates(entries: readonly string[]): Map<string, boolean> {
  const states = new Map<string, boolean>();
  const parsed = parseDefineEntries(entries);
  for (const { name } of parsed) {
    if (!states.has(name)) states.set(name, true);
  }
  for (const { name, on } of parsed) {
    if (!on) states.set(name, false);
  }
  return states;
}

/** The array entry that expresses `name` being on/off, in canonical form. */
export function formatDefineEntry(name: string, on: boolean): string {
  return on ? name : `${CANONICAL_NEGATION}${name}`;
}

/**
 * Apply one wanted state to the array, writing the MINIMAL entry.
 *
 * Every existing entry for the name (both forms, duplicates included) is
 * dropped first; the replacement — if one is needed at all — takes the
 * position of the first one dropped, so a settings.json diff stays small.
 * Entries for other defines are preserved verbatim, including ones the server
 * would drop: this UI does not silently delete what it does not understand.
 */
export function applyDefineEdit(entries: readonly string[], edit: DefineEdit): string[] {
  const replacement =
    edit.derivedOn !== undefined && edit.derivedOn === edit.on
      ? undefined
      : formatDefineEntry(edit.name, edit.on);

  const out: string[] = [];
  let placed = false;
  for (const raw of entries) {
    if (parseDefineEntry(raw)?.name !== edit.name) {
      out.push(raw);
      continue;
    }
    if (replacement !== undefined && !placed) {
      out.push(replacement);
      placed = true;
    }
  }
  if (replacement !== undefined && !placed) out.push(replacement);
  return out;
}

/**
 * Apply a batch of edits in one pass, so a manage session is ONE settings
 * write and therefore one server restart — not one per toggled row.
 */
export function applyDefineEdits(
  entries: readonly string[],
  edits: readonly DefineEdit[],
): string[] {
  return edits.reduce<string[]>((acc, edit) => applyDefineEdit(acc, edit), [...entries]);
}

/** Drop the given array elements verbatim (every copy of each). */
export function removeDefineEntries(entries: readonly string[], raws: readonly string[]): string[] {
  const doomed = new Set(raws);
  return entries.filter((raw) => !doomed.has(raw));
}

/**
 * Check a name the user typed.
 *
 * Errors are reserved for entries the SERVER itself drops — writing one would
 * put a line in settings.json that provably does nothing. Everything else is
 * at most a warning: the server stores names verbatim and deliberately does
 * not sanitise (see `dependency_define_suffix`, which maps `Dips++` to
 * `DIPS++` rather than to a well-formed identifier the game never defines),
 * so refusing an odd name would make this UI weaker than raw JSON — while
 * saying nothing would let a typo look like it worked.
 */
export function validateDefineEntry(raw: string): DefineNameIssue | undefined {
  const parsed = parseDefineEntry(raw);
  if (!parsed) {
    return {
      severity: 'error',
      message: 'Enter a define name, optionally prefixed with `-` or `!` to turn it off.',
    };
  }
  const { name } = parsed;
  if (IDENTIFIER.test(name)) return undefined;

  const mapped = name.replace(OPENPLANET_MAPPED, '_');
  const suggestion =
    mapped !== name && IDENTIFIER.test(mapped) ? ` Did you mean \`${mapped}\`?` : '';
  return {
    severity: 'warning',
    message:
      `\`${name}\` is not a valid preprocessor identifier, so no \`#if\` can ` +
      `name it — it will be defined but unusable.${suggestion}`,
  };
}

/**
 * Rows for the manage QuickPick.
 *
 * With `resolved` (a future server introspection answer) the rows are the
 * whole resolved set, in the server's order, with the user's overrides merged
 * on and any override the server did not mention appended.
 *
 * Without it — the situation today — the only defines the extension can name
 * truthfully are the user's own overrides, and the only honest origin is
 * `user`. It does NOT guess at the base set.
 */
export function buildDefineRows(
  entries: readonly string[],
  resolved?: readonly ResolvedDefine[],
): DefineRow[] {
  const states = overrideStates(entries);

  // The entry that DECIDES the effective state: the removal when the define
  // ends up off, the add when it ends up on. For a contradictory array that
  // is the `-NAME`, which is what the row should show and what removing would
  // change.
  const decidingEntry = new Map<string, string>();
  for (const parsed of parseDefineEntries(entries)) {
    if (parsed.on === states.get(parsed.name)) decidingEntry.set(parsed.name, parsed.raw);
  }

  if (!resolved) {
    return [...states].map(([name, active]) => ({
      name,
      active,
      origin: 'user' as const,
      entry: decidingEntry.get(name),
    }));
  }

  const rows: DefineRow[] = resolved.map((r) => ({
    name: r.name,
    active: r.active,
    origin: r.origin,
    derivedOn: r.derivedActive,
    entry: decidingEntry.get(r.name),
  }));
  const known = new Set(rows.map((r) => r.name));
  for (const [name, active] of states) {
    if (known.has(name)) continue;
    rows.push({
      name,
      active,
      origin: 'user',
      derivedOn: undefined,
      entry: decidingEntry.get(name),
    });
  }
  return rows;
}

/** Human label for an origin, shown greyed as the QuickPick `description`. */
export function describeOrigin(origin: DefineOrigin): string {
  switch (origin) {
    case 'target':
      return 'game target';
    case 'signature':
      return 'signature level';
    case 'os':
      return 'host OS';
    case 'arch':
      return 'architecture';
    case 'build':
      return 'build shape';
    case 'manifest':
      return 'info.toml';
    case 'dependency':
      return 'dependency';
    case 'dependency-missing':
      return 'dependency — not installed';
    case 'user':
      return 'user setting';
    default:
      return 'unknown origin';
  }
}

/**
 * The array an edit at `scope` should start from.
 *
 * A VS Code array setting does not merge across scopes — a workspace value
 * REPLACES the user one. So a first workspace edit is seeded from the value it
 * is about to shadow, or the user would silently lose every override they can
 * currently see. The reverse does not hold: the workspace value already
 * shadows the user one, so seeding the user array from it would add entries
 * that change nothing now and reappear when the workspace value goes away.
 */
export function baseEntriesForScope(inspected: InspectedDefines, scope: DefinesScope): string[] {
  if (scope === 'user') return [...(inspected.globalValue ?? [])];
  return [...(inspected.workspaceValue ?? inspected.globalValue ?? [])];
}

/**
 * What clearing at `scope` should write.
 *
 * `unset` removes the key so settings.json stays clean. `empty` writes `[]`
 * instead, for the one case where unsetting would not clear anything: a
 * workspace clear while the user-global array is non-empty and would
 * reappear.
 */
export function planClearOverrides(inspected: InspectedDefines, scope: DefinesScope): ClearPlan {
  const scopeValue = scope === 'workspace' ? inspected.workspaceValue : inspected.globalValue;
  const shadowed = scope === 'workspace' && (inspected.globalValue?.length ?? 0) > 0;
  if (scopeValue !== undefined && scopeValue.length > 0) {
    return { action: shadowed ? 'empty' : 'unset' };
  }
  if (scopeValue === undefined && shadowed) return { action: 'empty' };
  return { action: 'noop' };
}
