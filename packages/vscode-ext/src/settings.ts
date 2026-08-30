/**
 * Settings → initializationOptions translation.
 *
 * Pure functions (no `vscode` import) so they are unit-testable.
 *
 * Precedence contract: the server layers config as
 *   auto-detect < repo .openplanet-lsp.toml < user config < initializationOptions.
 * VS Code settings must therefore only forward keys the user actually set —
 * an unset setting forwards NOTHING, so the workspace's .openplanet-lsp.toml
 * keeps control. Only explicitly-set values override.
 */

/** Raw setting values as read from the openplanetLsp configuration section. */
export interface OpenplanetLspSettings {
  /** Absolute path override for the server binary (extension-local; never sent). */
  serverPath?: string;
  openplanetDir?: string;
  pluginsDir?: string;
  gameTarget?: string;
  /** Openplanet signature level whose SIG_* defines are live (GH #64). */
  signatureMode?: string;
  defines?: string[];
  /** Manual plugin-root override: dirs containing info.toml. When empty, the server auto-discovers. */
  pluginRoots?: string[];
  /** How unused declarations are reported (server B030). '' = unset. */
  unused?: string;
  /** How preprocessor-dead `#if` branches are greyed out (server B031). '' = unset. */
  inactiveRegions?: string;
}

/** Valid `game_target` values accepted by the server (config.rs defines_for_target). */
export const GAME_TARGETS = [
  'TMNEXT',
  'MP4',
  'MP40',
  'MP41',
  'TURBO',
  'MP3',
  'UNITED_FOREVER',
  'UNITED',
  'NATIONS_FOREVER',
] as const;

export type GameTarget = (typeof GAME_TARGETS)[number];

export function isValidGameTarget(v: string): v is GameTarget {
  return (GAME_TARGETS as readonly string[]).includes(v);
}

/**
 * Platform selectors grouped by game generation — the OFFLINE FALLBACK.
 *
 * SOURCE OF TRUTH: `LspConfig::PLATFORM_FAMILIES` in the server's
 * `src/config.rs`, and since B050 it is READABLE: every
 * `openplanet/resolvedDefines` answer carries `platformFamilies`, and callers
 * that have one pass it to {@link platformFamilyFor} in preference to this
 * table. B034 had to duplicate the constant because no request exposed it;
 * that reason is gone.
 *
 * The copy is not, because the guard has one consumer the server cannot
 * serve: `validateDefineEntry` runs inside an InputBox validator, which is
 * synchronous and must still work with the server stopped, crashed, or older
 * than B050. So this is what the guard falls back to, not what it prefers.
 *
 * Drift is cheap by construction and now bounded to that offline path: the
 * only consumer is a NON-BLOCKING warning (`platformSelectorCaution` in
 * defines.ts), so a stale table costs a spurious warning or a missing one —
 * never a blocked edit and never a behaviour change. The names are
 * ManiaPlanet/Trackmania generations, which are historical and effectively
 * frozen. `PLATFORM_FAMILIES` covering exactly `GAME_TARGETS` is pinned by a
 * test.
 */
export const PLATFORM_FAMILIES: readonly (readonly GameTarget[])[] = [
  ['TMNEXT'],
  ['MP4', 'MP40', 'MP41'],
  ['TURBO'],
  ['MP3'],
  ['UNITED_FOREVER', 'UNITED'],
  ['NATIONS_FOREVER'],
] as const;

/** A family table, as the server reports it or as bundled above. */
export type PlatformFamilies = readonly (readonly string[])[];

/**
 * The platform selectors a game target implies, or `undefined` for a name
 * outside the known families. Mirrors `platform_family_for_target`.
 *
 * `families` is the server's table when the caller has one. An EMPTY table is
 * treated as no answer and falls back to the bundled copy — a server that
 * reported no families at all has told us nothing, and silently answering
 * "no family" would turn every selector into a foreign one and fire the
 * warning on all of them.
 */
export function platformFamilyFor(
  target: string,
  families?: PlatformFamilies,
): readonly string[] | undefined {
  const table = families && families.length > 0 ? families : PLATFORM_FAMILIES;
  return table.find((family) => (family as readonly string[]).includes(target));
}

/** True for any known platform selector (`TMNEXT`, `MP41`, `TURBO`, ...). */
export function isPlatformSelector(name: string, families?: PlatformFamilies): boolean {
  return platformFamilyFor(name, families) !== undefined;
}

/**
 * Valid `signature_mode` values (server config.rs SignatureMode).
 *
 * Openplanet defines a signature macro when the current level is equal or
 * BELOW that macro's level, so the levels are cumulative: `official` gives
 * `SIG_OFFICIAL`, `developer` gives all four. `developer` is the server
 * default and the set the LSP always used.
 */
export const SIGNATURE_MODES = ['developer', 'school', 'regular', 'official'] as const;

export type SignatureMode = (typeof SIGNATURE_MODES)[number];

export function isValidSignatureMode(v: string): v is SignatureMode {
  return (SIGNATURE_MODES as readonly string[]).includes(v);
}

/**
 * Valid `unused` values accepted by the server (config.rs UnusedLevel).
 *
 * `hint` and `info` report the same findings at a quieter severity and never
 * fail a `check`; every finding is tagged Unnecessary at all levels, so the
 * editor fades the declaration regardless. The server also accepts aliases
 * (off/grey/note/...), but the setting is an enum — offer the canonical set
 * only, and drop anything else rather than forwarding garbage.
 */
export const UNUSED_LEVELS = ['ignore', 'hint', 'info', 'warn', 'error'] as const;

export type UnusedLevel = (typeof UNUSED_LEVELS)[number];

export function isValidUnusedLevel(v: string): v is UnusedLevel {
  return (UNUSED_LEVELS as readonly string[]).includes(v);
}

/**
 * Valid `inactive_regions` values accepted by the server (config.rs
 * InactiveLevel).
 *
 * Deliberately no warn/error: a branch that is off for the current target is
 * dead BY DESIGN, not a defect. `hint` fades it in the editor without listing
 * it; `info` also lists it. The fade itself comes from the LSP `Unnecessary`
 * tag, which the server sends at both levels.
 */
export const INACTIVE_LEVELS = ['ignore', 'hint', 'info'] as const;

export type InactiveLevel = (typeof INACTIVE_LEVELS)[number];

export function isValidInactiveLevel(v: string): v is InactiveLevel {
  return (INACTIVE_LEVELS as readonly string[]).includes(v);
}

/**
 * Build the `initializationOptions` object to send at `initialize`.
 * Only includes keys with non-empty values (see precedence contract above).
 * Returns an empty object when nothing is set — sending `{}` is fine; the
 * server's config-file layers then apply.
 */
export function buildInitializationOptions(
  settings: OpenplanetLspSettings,
): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  if (settings.openplanetDir && settings.openplanetDir.trim() !== '') {
    opts.openplanet_dir = settings.openplanetDir;
  }
  if (settings.pluginsDir && settings.pluginsDir.trim() !== '') {
    opts.plugins_dir = settings.pluginsDir;
  }
  if (settings.gameTarget && settings.gameTarget !== 'TMNEXT') {
    // 'TMNEXT' is the server default — forwarding it would needlessly
    // override a repo config that sets a different target.
    if (isValidGameTarget(settings.gameTarget)) {
      opts.game_target = settings.gameTarget;
    }
  }
  if (settings.signatureMode && settings.signatureMode !== 'developer') {
    // 'developer' is the server default (every SIG_* on) — forwarding it
    // would needlessly override a repo config that narrows the level.
    if (isValidSignatureMode(settings.signatureMode)) {
      opts.signature_mode = settings.signatureMode;
    }
  }
  if (settings.defines && settings.defines.length > 0) {
    opts.defines = settings.defines;
  }
  if (settings.unused && settings.unused.trim() !== '') {
    // No default sentinel to skip here: the setting's own default is '',
    // meaning "send nothing". Forwarding 'warn' on the user's behalf would
    // override a repo .openplanet-lsp.toml that pins unused = "ignore".
    const level = settings.unused.trim();
    if (isValidUnusedLevel(level)) {
      opts.unused = level;
    }
  }
  if (settings.inactiveRegions && settings.inactiveRegions.trim() !== '') {
    // Same unset-means-silent contract as `unused`: the setting's default is
    // '', so a workspace .openplanet-lsp.toml keeps control until the user
    // picks a level.
    const level = settings.inactiveRegions.trim();
    if (isValidInactiveLevel(level)) {
      opts.inactive_regions = level;
    }
  }
  if (settings.pluginRoots && settings.pluginRoots.length > 0) {
    // Non-empty replaces the server's automatic downward workspace scan;
    // empty/unset forwards nothing so auto-discovery keeps control (t2).
    const roots = settings.pluginRoots.filter((r) => r.trim() !== '');
    if (roots.length > 0) {
      opts.plugin_roots = roots;
    }
  }
  return opts;
}
