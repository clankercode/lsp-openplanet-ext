import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural tests for the contributed snippets (B042).
 *
 * Snippets are declarative, so nothing here can prove a snippet is *useful* —
 * that is the manual gate (insert each one and run `openplanet-lsp check`).
 * What these tests do catch is the silent-failure class: a malformed tab stop,
 * a duplicate prefix that shadows another snippet, a bare prefix that fires on
 * ordinary typing, a package.json pointing at a file that does not exist, and
 * non-ASCII that would land in a user's source file.
 */

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgJsonPath = join(pkgRoot, 'package.json');

interface SnippetEntry {
  prefix?: unknown;
  body?: unknown;
  description?: unknown;
}

interface ContributedSnippet {
  language?: unknown;
  path?: unknown;
}

/** The namespace every prefix must carry (see B042 design decision). */
const PREFIX_NAMESPACE = 'op';

/**
 * Snippet files are JSONC by convention in VS Code, and this one carries a
 * provenance header. Comments only ever appear before the root `{`, so the
 * stripper is deliberately dumb: it drops leading blank/`//` lines and stops
 * at the first line that is neither. A regex over the whole file would eat
 * the `//` inside the documentation URLs.
 */
export function stripLeadingComments(text: string): string {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('//')) {
      i += 1;
      continue;
    }
    break;
  }
  return lines.slice(i).join('\n');
}

function readPackageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as Record<string, unknown>;
}

function contributedSnippets(): ContributedSnippet[] {
  const pkg = readPackageJson();
  const contributes = pkg.contributes as Record<string, unknown> | undefined;
  const snippets = contributes?.snippets;
  return Array.isArray(snippets) ? (snippets as ContributedSnippet[]) : [];
}

/** Body may be a string or an array of lines; normalise to one string. */
function bodyText(body: unknown): string {
  return Array.isArray(body) ? body.join('\n') : String(body);
}

/**
 * All tab stops in a body, in textual order, as numbers.
 *
 * Handles the three VS Code forms: `$1`, `${1:placeholder}` and the choice
 * form `${1|a,b|}`. Nested placeholders are matched too because the scan is
 * per-occurrence rather than a structural parse.
 */
function tabStops(body: string): number[] {
  const stops: number[] = [];
  const re = /\$(\d+)|\$\{(\d+)[:|}]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    stops.push(Number(m[1] ?? m[2]));
  }
  return stops;
}

describe('contributes.snippets wiring', () => {
  it('declares at least one snippet contribution', () => {
    expect(contributedSnippets().length).toBeGreaterThan(0);
  });

  it('every contribution targets the angelscript language', () => {
    for (const entry of contributedSnippets()) {
      expect(entry.language).toBe('angelscript');
    }
  });

  it('every contributed path exists on disk', () => {
    for (const entry of contributedSnippets()) {
      expect(typeof entry.path).toBe('string');
      const abs = resolve(pkgRoot, entry.path as string);
      expect(existsSync(abs), `missing snippet file: ${abs}`).toBe(true);
    }
  });

  it('snippet files are not excluded from the packaged VSIX', () => {
    // A .vscodeignore entry for snippets/ would ship a manifest pointing at a
    // file the VSIX does not contain — the extension host logs and moves on,
    // so this only ever surfaces as "snippets do not work in the marketplace
    // build". Cheap to assert here.
    const ignore = readFileSync(join(pkgRoot, '.vscodeignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    for (const entry of contributedSnippets()) {
      const dir = String(entry.path).replace(/^\.\//, '').split('/')[0];
      expect(ignore).not.toContain(`${dir}/**`);
      expect(ignore).not.toContain(dir);
    }
  });
});

describe('angelscript snippet file', () => {
  const paths = contributedSnippets().map((e) => resolve(pkgRoot, String(e.path)));

  it.each(paths)('%s parses as JSON once the header comments are stripped', (p) => {
    const raw = readFileSync(p, 'utf8');
    expect(() => JSON.parse(stripLeadingComments(raw))).not.toThrow();
  });

  it.each(paths)('%s cites the Openplanet docs in its header comment', (p) => {
    // The signatures are only trustworthy if the source is recorded; a future
    // editor needs to know where to re-verify.
    const raw = readFileSync(p, 'utf8');
    const header = raw.slice(0, raw.indexOf('{'));
    expect(header).toContain('https://openplanet.dev/docs/reference/plugin-callbacks');
  });

  it.each(paths)('%s is pure ASCII', (p) => {
    // A smart quote or non-breaking space pasted into a snippet body lands in
    // the user's .as file and fails to compile in a way that looks like magic.
    const raw = readFileSync(p, 'utf8');
    const bad = [...raw].filter((ch) => ch.charCodeAt(0) > 127);
    expect(bad, `non-ASCII characters: ${JSON.stringify(bad)}`).toEqual([]);
  });
});

function loadSnippets(): Record<string, SnippetEntry> {
  const entries = contributedSnippets();
  const merged: Record<string, SnippetEntry> = {};
  for (const entry of entries) {
    const raw = readFileSync(resolve(pkgRoot, String(entry.path)), 'utf8');
    Object.assign(merged, JSON.parse(stripLeadingComments(raw)) as Record<string, SnippetEntry>);
  }
  return merged;
}

describe('snippet entries', () => {
  const snippets = loadSnippets();
  const names = Object.keys(snippets);

  it('has a non-trivial number of snippets', () => {
    expect(names.length).toBeGreaterThanOrEqual(20);
  });

  it.each(names)('%s has prefix, body and description', (name) => {
    const s = snippets[name];
    expect(typeof s.prefix).toBe('string');
    expect(String(s.prefix).length).toBeGreaterThan(0);
    expect(Array.isArray(s.body) || typeof s.body === 'string').toBe(true);
    expect(bodyText(s.body).length).toBeGreaterThan(0);
    expect(typeof s.description).toBe('string');
    expect(String(s.description).length).toBeGreaterThan(0);
  });

  it('every prefix is unique', () => {
    const prefixes = names.map((n) => String(snippets[n].prefix));
    const dupes = prefixes.filter((p, i) => prefixes.indexOf(p) !== i);
    expect(dupes).toEqual([]);
  });

  it.each(names)('%s uses a namespaced prefix', (name) => {
    // Bare `main` / `render` would insert on ordinary identifier typing.
    const prefix = String(snippets[name].prefix);
    expect(prefix.startsWith(PREFIX_NAMESPACE)).toBe(true);
    expect(prefix.length).toBeGreaterThan(PREFIX_NAMESPACE.length);
    expect(prefix).toMatch(/^[a-z][a-z0-9]*$/);
  });

  it.each(names)('%s has well-formed, sequential tab stops', (name) => {
    const body = bodyText(snippets[name].body);
    const stops = tabStops(body);

    // $0 is the exit stop: exactly one, and no snippet should leave the
    // cursor in an undefined place.
    expect(stops.filter((n) => n === 0).length, `${name}: expected exactly one $0`).toBe(1);

    const numbered = [...new Set(stops.filter((n) => n > 0))].sort((a, b) => a - b);
    // Contiguous from 1: a gap (e.g. $1, $3) silently drops a stop from the
    // traversal, which the user experiences as Tab skipping a field.
    numbered.forEach((n, i) => {
      expect(n, `${name}: tab stops must run 1..N with no gaps, got ${numbered.join(',')}`).toBe(
        i + 1,
      );
    });

    // $0 is the LAST stop in traversal order, so nothing numbered may follow
    // it textually — otherwise Tab exits the snippet before reaching them.
    const zeroAt = body.search(/\$0|\$\{0[:|}]/);
    const afterZero = tabStops(body.slice(zeroAt + 1)).filter((n) => n > 0);
    expect(afterZero, `${name}: numbered tab stops appear after $0`).toEqual([]);

    // No stray `$` followed by a brace-less non-stop that VS Code would eat.
    expect(body, `${name}: escape a literal $`).not.toMatch(/\$(?![0-9{])/);
  });
});
