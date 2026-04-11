/**
 * Grammar build script: compiles angelscript.tmLanguage.yaml → JSON and
 * copies the output to:
 *   packages/grammar/syntaxes/angelscript.tmLanguage.json  (canonical built artifact)
 *   packages/vscode-ext/syntaxes/angelscript.tmLanguage.json  (VSIX source)
 *
 * Run: pnpm exec tsx build.ts   (from packages/grammar/)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

const SRC = join(__dirname, 'src', 'angelscript.tmLanguage.yaml');
const OUT_GRAMMAR = join(__dirname, 'syntaxes', 'angelscript.tmLanguage.json');
const OUT_VSCODE = join(root, 'packages', 'vscode-ext', 'syntaxes', 'angelscript.tmLanguage.json');

const yaml = readFileSync(SRC, 'utf8');
const grammar: unknown = parseYaml(yaml);
const json = JSON.stringify(grammar, null, 2) + '\n';

mkdirSync(dirname(OUT_GRAMMAR), { recursive: true });
mkdirSync(dirname(OUT_VSCODE), { recursive: true });

writeFileSync(OUT_GRAMMAR, json);
writeFileSync(OUT_VSCODE, json);

const lines = json.split('\n').length;
console.log(`✅ built grammar (${lines} lines) → syntaxes/ and packages/vscode-ext/syntaxes/`);
