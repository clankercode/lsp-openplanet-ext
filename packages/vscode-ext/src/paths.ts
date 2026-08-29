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

/**
 * Longest-first, de-duplicated, trailing-separator-trimmed home aliases.
 * `/` and `` are dropped: they would abbreviate every absolute path.
 */
function homeAliases(homes: readonly string[]): string[] {
  return [
    ...new Set(
      homes
        .filter((h): h is string => typeof h === 'string')
        .map((h) => h.replace(/[\\/]+$/, ''))
        .filter((h) => h !== '' && h !== '/' && h !== '\\'),
    ),
  ].sort((a, b) => b.length - a.length);
}

/** First alias that abbreviates `p`, or `p` unchanged. */
function abbreviateAny(p: string, aliases: readonly string[], platform: string): string {
  for (const alias of aliases) {
    const out = abbreviateHome(p, alias, platform);
    if (out !== undefined && out !== p) return out;
  }
  return p;
}

/**
 * Characters that separate a path from surrounding prose.
 *
 * `:` is a delimiter on POSIX (`PATH=a:b`, `launching:/path`) but NOT on
 * Windows, where `C:\` is structural.
 */
function delimiters(platform: string): RegExp {
  const chars = '\\s"\'`,;=<>()\\[\\]{}|@!?*' + (isWindows(platform) ? '' : ':');
  return new RegExp(`([${chars}]+)`);
}

/**
 * Noise that can precede an absolute path inside a single prose token: CLI
 * dashes, a URI scheme, and the surplus separators in `file:///`.
 *
 * The scheme branch requires a following `//` so a Windows drive letter
 * (`C:\Users\...`) is not mistaken for one - that mistake ate the drive and
 * let the whole path through.
 */
const LEADING_NOISE = /^-*(?:[A-Za-z][A-Za-z0-9+.-]*:(?=\/\/))?(?:[\\/](?=[\\/]))*/;

/** Sentence punctuation that ends a path in prose but never in a filename. */
const TRAILING_PROSE = /[.,;:!?]+$/;

/**
 * Redact every home-path occurrence in diagnostic prose.
 *
 * `abbreviateHome` only accepts a complete path, but server errors are prose
 * ("spawn /home/max/bin/... ENOENT", "cwd=/home/max/src"), so the report needs
 * a text variant. Rather than reason character-by-character about what counts
 * as a path boundary - four separate leaks came out of exactly that - this
 * splits the text on the punctuation that separates a path from prose and
 * hands each token to the strict matcher.
 *
 * The asymmetry is deliberate. A missed redaction publishes the user's account
 * name; a false one is cosmetic damage to a diagnostic dump. So the leading
 * side is permissive (any punctuation may precede a path) while the trailing
 * side keeps the strict component check, because THAT is the side where being
 * wrong also leaks - `/home/maxwell` half-replaced still reads `~well`.
 */
export function abbreviateHomeInText(
  text: string | undefined,
  homes: readonly string[],
  platform: string = process.platform,
): string | undefined {
  if (text === undefined || text === '') return text;
  const aliases = homeAliases(homes);
  if (aliases.length === 0) return text;

  return text
    .split(delimiters(platform))
    .map((token) => redactToken(token, aliases, platform))
    .join('');
}

function redactToken(token: string, aliases: readonly string[], platform: string): string {
  if (token === '') return token;

  const noise = LEADING_NOISE.exec(token)?.[0] ?? '';
  const rest = token.slice(noise.length);
  const tail = TRAILING_PROSE.exec(rest)?.[0] ?? '';
  const core = tail === '' ? rest : rest.slice(0, -tail.length);
  if (core === '') return token;

  const abbreviated = abbreviateAny(core, aliases, platform);
  return abbreviated === core ? token : noise + abbreviated + tail;
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
