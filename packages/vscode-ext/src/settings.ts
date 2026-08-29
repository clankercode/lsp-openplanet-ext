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
