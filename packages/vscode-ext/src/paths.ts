/**
 * Path presentation helpers (B043).
 *
 * Pure (no `vscode` import) so they are unit-testable.
 *
 * `showStatus` output is written to be pasted into a GitHub issue, so every
 * path it prints goes through `abbreviateHome` first. Nothing here tries to
 * be a general anonymiser — it collapses the one prefix that is both
 * unavoidable (server paths, workspace roots and the type DB all live under
 * it) and personally identifying.
 */

/** Windows path comparison is case-insensitive; POSIX is not. */
function isWindows(platform: string): boolean {
  return platform === 'win32';
}

/** Both separators are legal on Windows; normalise before comparing. */
function normalize(p: string, platform: string): string {
  const slashed = isWindows(platform) ? p.replace(/\\/g, '/') : p;
  return isWindows(platform) ? slashed.toLowerCase() : slashed;
}

/**
 * Replace a leading home directory with `~`.
 *
 * Only matches on a path boundary: `/home/max` does NOT abbreviate
 * `/home/maxwell/plugin`, which a naive `startsWith` would mangle into
 * `~well/plugin` — wrong, and worse, it would still leak the username.
 * Returns the input unchanged when there is no home to strip.
 */
export function abbreviateHome(
  p: string | undefined,
  home: string | undefined,
  platform: string = process.platform,
): string | undefined {
  if (p === undefined || p === '') return p;
  if (!home || home === '') return p;

  // A trailing separator on $HOME would otherwise make the boundary check
  // look for a doubled separator and never match.
  const trimmedHome = home.replace(/[\\/]+$/, '');
  if (trimmedHome === '') return p;

  const np = normalize(p, platform);
  const nh = normalize(trimmedHome, platform);

  if (np === nh) return '~';
  if (np.startsWith(nh + '/')) {
    // Slice from the ORIGINAL string so the case and separators the user sees
    // are preserved past the prefix.
    return '~' + p.slice(trimmedHome.length);
  }
  return p;
}

/** Map `abbreviateHome` over a list, dropping empties. */
export function abbreviateAll(
  paths: readonly string[] | undefined,
  home: string | undefined,
  platform: string = process.platform,
): string[] {
  if (!paths) return [];
  return paths
    .filter((p) => p !== undefined && p !== null && String(p).trim() !== '')
    .map((p) => abbreviateHome(p, home, platform) as string);
}
