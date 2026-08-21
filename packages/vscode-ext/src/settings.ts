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
  defines?: string[];
  /** Manual plugin-root override: dirs containing info.toml. When empty, the server auto-discovers. */
  pluginRoots?: string[];
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
  if (settings.defines && settings.defines.length > 0) {
    opts.defines = settings.defines;
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
