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

/** True for a character that can continue a filesystem path. */
function isPathCharacter(ch: string): boolean {
  return /[A-Za-z0-9_.~\\/\\:-]/.test(ch);
}

function isSeparator(ch: string, platform: string): boolean {
  return ch === '/' || (isWindows(platform) && ch === '\\');
}

/**
 * Redact every home-path occurrence in diagnostic prose.
 *
 * `abbreviateHome` deliberately only accepts a complete path. Server errors
 * are prose such as "spawn /home/max/bin/... failed", so report rendering
 * needs a boundary-aware text variant. Multiple aliases cover the physical
 * path when the logical HOME path is a symlink.
 */
export function abbreviateHomeInText(
  text: string | undefined,
  homes: readonly string[],
  platform: string = process.platform,
): string | undefined {
  if (text === undefined || text === '' || homes.length === 0) return text;

  const aliases = [
    ...new Set(
      homes
        .map((home) => home.replace(/[\\/]+$/, ''))
        .filter((home) => home !== '' && home !== '/' && home !== '\\')
        .sort((a, b) => b.length - a.length),
    ),
  ];
  let result = text;

  for (const alias of aliases) {
    const normalizedAlias = normalize(alias, platform);
    const normalizedText = normalize(result, platform);
    let cursor = 0;
    let redacted = '';

    while (cursor < result.length) {
      const index = normalizedText.indexOf(normalizedAlias, cursor);
      if (index < 0) break;
      const end = index + alias.length;
      const before = index === 0 ? undefined : result[index - 1];
      const after = end === result.length ? undefined : result[end];
      const startsOnBoundary =
        before === undefined ||
        !isPathCharacter(before) ||
        (alias.startsWith('/') && before === '/');
      // A home directory can end a path in diagnostic prose too: "failed to
      // open /home/max (EACCES)". Keep word-like continuations guarded so a
      // sibling such as /home/maxwell is never partially replaced.
      const endsOnBoundary =
        after === undefined || isSeparator(after, platform) || !/[A-Za-z0-9_.~]/.test(after);

      if (startsOnBoundary && endsOnBoundary) {
        redacted += result.slice(cursor, index) + '~';
        cursor = end;
      } else {
        redacted += result.slice(cursor, end);
        cursor = end;
      }
    }

    if (cursor > 0) result = redacted + result.slice(cursor);
  }

  return result;
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
