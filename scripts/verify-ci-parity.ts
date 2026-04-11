import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const EXCLUDED = new Set(['pnpm install --frozen-lockfile', 'pnpm install']);

/**
 * Extracts `run:` values from a GitHub Actions workflow YAML.
 * Returns a set of distinct shell commands. Intentionally primitive — we
 * match `- run: <command>` and `run: <command>` lines, which is enough for
 * the shape our workflows take. If we ever start using `|` multiline runs
 * this parser needs to grow; for now, single-line `run:` is the rule.
 */
export function extractCiCommands(yaml: string): Set<string> {
  const cmds = new Set<string>();
  const lineRegex = /^\s*-?\s*run:\s*(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(yaml)) !== null) {
    let cmd = match[1]!.trim();
    // Strip surrounding quotes if present.
    if ((cmd.startsWith('"') && cmd.endsWith('"')) || (cmd.startsWith("'") && cmd.endsWith("'"))) {
      cmd = cmd.slice(1, -1);
    }
    if (EXCLUDED.has(cmd)) continue;
    cmds.add(cmd);
  }
  return cmds;
}

/**
 * Extracts the shell commands invoked by the `ci:` recipe in a justfile.
 * We follow one level of dependency: the `ci:` recipe lists sub-recipes, and
 * each sub-recipe has its own command lines. We parse both.
 */
export function extractJustCiCommands(just: string): Set<string> {
  const lines = just.split(/\r?\n/);
  const recipes = new Map<string, string[]>();
  let currentRecipe: string | null = null;

  for (const raw of lines) {
    // Recipe header: name followed by `:` and optional deps
    const header = /^([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*([^#]*?)\s*$/.exec(raw);
    if (header && !raw.startsWith(' ') && !raw.startsWith('\t')) {
      currentRecipe = header[1]!;
      // Deps listed after the colon become part of the body graph
      const deps = (header[2] ?? '').trim().split(/\s+/).filter(Boolean);
      recipes.set(currentRecipe, deps.length > 0 ? [`__deps__:${deps.join(',')}`] : []);
      continue;
    }
    if (currentRecipe && /^(    |\t)/.test(raw)) {
      const body = raw.replace(/^(    |\t)/, '').trim();
      if (body && !body.startsWith('#')) {
        recipes.get(currentRecipe)!.push(body);
      }
    }
  }

  const cmds = new Set<string>();
  const visited = new Set<string>();

  function walk(recipe: string): void {
    if (visited.has(recipe)) return;
    visited.add(recipe);
    const body = recipes.get(recipe) ?? [];
    for (const line of body) {
      if (line.startsWith('__deps__:')) {
        const deps = line.slice('__deps__:'.length).split(',').filter(Boolean);
        for (const d of deps) walk(d);
        continue;
      }
      if (line.startsWith('@')) {
        cmds.add(line.slice(1));
      } else {
        cmds.add(line);
      }
    }
  }

  walk('ci');
  return cmds;
}

export interface CompareResult {
  ok: boolean;
  missing: string[]; // in ci.yml, absent from just ci
}

export function compareCommandSets(ciCmds: Set<string>, justCmds: Set<string>): CompareResult {
  const missing: string[] = [];
  for (const c of ciCmds) {
    if (!justCmds.has(c)) missing.push(c);
  }
  return { ok: missing.length === 0, missing };
}

function main(): void {
  const ciYaml = readFileSync('.github/workflows/ci.yml', 'utf8');
  const justfile = readFileSync('justfile', 'utf8');
  const ciCmds = extractCiCommands(ciYaml);
  const justCmds = extractJustCiCommands(justfile);
  const result = compareCommandSets(ciCmds, justCmds);
  if (!result.ok) {
    console.error('❌ ci.yml contains commands that are not invoked by `just ci`:');
    for (const m of result.missing) console.error(`  - ${m}`);
    console.error('\nEither add them to the justfile ci recipe (or a sub-recipe it calls),');
    console.error('or remove them from ci.yml. Parity is enforced to prevent drift.');
    process.exit(1);
  }
  console.log(`✅ just ci covers all ${ciCmds.size} ci.yml commands`);
}

// Robust main-detection that works across platforms (Linux, macOS, Windows).
// `fileURLToPath` turns the module URL into an OS-native filesystem path, which
// we can compare directly to `process.argv[1]` (also an OS-native path).
const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath) main();
