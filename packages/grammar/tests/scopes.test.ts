/**
 * Grammar scope tests: tokenize the corpus with vscode-textmate (real
 * Oniguruma engine — the same one VS Code uses) and assert scopes.
 *
 * Run: cd packages/grammar && pnpm test   (vitest)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vsctm from 'vscode-textmate';
import oniguruma from 'vscode-oniguruma';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBin = readFileSync(
  join(__dirname, '..', 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm'),
);

let registryPromise: Promise<vsctm.Registry> | undefined;

function getRegistry(): Promise<vsctm.Registry> {
  if (!registryPromise) {
    registryPromise = (async () => {
      const onigLib: vsctm.IOnigLib = {
        createOnigScanner: (sources: string[]) => new oniguruma.OnigScanner(sources),
        createOnigString: (str: string) => new oniguruma.OnigString(str),
      };
      await oniguruma.loadWASM(wasmBin.buffer);
      const grammarObj = parseYaml(
        readFileSync(join(__dirname, '..', 'src', 'angelscript.tmLanguage.yaml'), 'utf8'),
      );
      return new vsctm.Registry({
        onigLib: Promise.resolve(onigLib),
        loadGrammar: async (scopeName) =>
          scopeName === 'source.angelscript' ? (grammarObj as vsctm.IRawGrammar) : null,
      });
    })();
  }
  return registryPromise;
}

const corpus = readFileSync(join(__dirname, '..', 'testcorpus', 'sample.as'), 'utf8');

/** Tokenize the corpus; returns per-line token lists. */
async function tokenize() {
  const reg = await getRegistry();
  const grammar = await reg.loadGrammar('source.angelscript');
  if (!grammar) throw new Error('grammar failed to load');
  const lines = corpus.split('\n');
  const result: { text: string; scopes: string[] }[][] = [];
  let stack = vsctm.INITIAL;
  for (const line of lines) {
    const r = grammar.tokenizeLine(line, stack, 0);
    stack = r.ruleStack;
    // vscode-textmate tokens expose startIndex/endIndex — derive text.
    result.push(
      r.tokens.map((t) => ({
        text: line.slice(t.startIndex, t.endIndex),
        scopes: t.scopes,
      })),
    );
  }
  return result;
}

/** Find the first token whose text contains `needle` and return its scopes. */
function scopeOf(
  tokens: { text: string; scopes: string[] }[][],
  needle: string,
  lineHint?: number,
): string[] | undefined {
  const search = lineHint !== undefined ? [tokens[lineHint]] : tokens;
  for (const line of search) {
    if (!line) continue;
    for (const t of line) {
      if (t.text.includes(needle)) return t.scopes;
    }
  }
  if (lineHint !== undefined) return scopeOf(tokens, needle); // fall back to whole file
  return undefined;
}

describe('AngelScript grammar scopes', () => {
  it('loads and tokenizes without errors', async () => {
    const tokens = await tokenize();
    expect(tokens.length).toBeGreaterThan(50);
  });

  it('highlights comments', async () => {
    const tokens = await tokenize();
    // Line 1 is a // comment; find a comment-scoped token containing 'preprocessor'
    expect(scopeOf(tokens, 'preprocessor ──')?.some((s) => s.startsWith('comment.line'))).toBe(
      true,
    );
  });

  it('highlights #include directive and its string argument', async () => {
    const tokens = await tokenize();
    expect(
      scopeOf(tokens, '#include')?.some((s) => s.includes('keyword.control.directive.include')),
    ).toBe(true);
    expect(
      scopeOf(tokens, '"SomeLib/Main.as"')?.some((s) => s.startsWith('string.quoted.double')),
    ).toBe(true);
    expect(
      scopeOf(tokens, '<Other/Util.as>')?.some((s) => s.startsWith('string.quoted.other')),
    ).toBe(true);
  });

  it('highlights #if/#elif/#else/#endif directives', async () => {
    const tokens = await tokenize();
    for (const d of ['#if', '#elif', '#else', '#endif', '#define', '#undef']) {
      const scopes = scopeOf(tokens, d);
      expect(
        scopes?.some((s) => s.includes('keyword.control.directive')),
        `'${d}' directive`,
      ).toBe(true);
    }
  });

  it('highlights preprocessor condition identifiers (TMNEXT, DEPENDENCY_*)', async () => {
    const tokens = await tokenize();
    expect(
      scopeOf(tokens, 'TMNEXT')?.some((s) => s.includes('entity.name.function.preprocessor')),
    ).toBe(true);
  });

  it('highlights meta attributes [Setting ...]', async () => {
    const tokens = await tokenize();
    // The '[' and attribute name are separate tokens; check both.
    expect(
      tokens
        .flat()
        .find((t) => t.text === '[' && t.scopes.some((s) => s.includes('meta.attribute'))),
    ).toBeDefined();
    expect(
      tokens
        .flat()
        .find(
          (t) => t.text === 'Setting' && t.scopes.some((s) => s.includes('entity.name.attribute')),
        ),
    ).toBeDefined();
    expect(scopeOf(tokens, '"Visible setting"')?.some((s) => s.startsWith('string.quoted'))).toBe(
      true,
    );
  });

  it('highlights triple-quoted multi-line strings', async () => {
    const tokens = await tokenize();
    // Opening """ punctuation + string content on the first line…
    expect(
      tokens
        .flat()
        .find(
          (t) =>
            t.text === '"""' &&
            t.scopes.some((s) => s.includes('punctuation.definition.string.begin')),
        ),
    ).toBeDefined();
    // …and string-scoped continuation lines.
    expect(scopeOf(tokens, 'still string')?.some((s) => s.startsWith('string.quoted.triple'))).toBe(
      true,
    );
  });

  it('highlights single-quoted strings', async () => {
    const tokens = await tokenize();
    // The opening ' quote token carries string.quoted.single scope.
    expect(
      tokens
        .flat()
        .find(
          (t) =>
            t.text.trim() === "'" && t.scopes.some((s) => s.startsWith('string.quoted.single')),
        ),
    ).toBeDefined();
    expect(scopeOf(tokens, 'single')?.some((s) => s.startsWith('string.quoted.single'))).toBe(true);
  });

  it('highlights numeric literals incl. binary/octal/hex/suffix forms', async () => {
    const tokens = await tokenize();
    for (const lit of ['0xFF', '0b1010_0110', '0o777', '25.5e2', '0.5f']) {
      expect(
        scopeOf(tokens, lit)?.some((s) => s.startsWith('constant.numeric')),
        lit,
      ).toBe(true);
    }
    // Trailing-dot and lone-suffix floats must stay ONE numeric token
    // (not `25` + `.`): find the full token text on those corpus lines.
    const flat = tokens.flat();
    expect(
      flat.find((t) => t.text === '25.' && t.scopes.some((s) => s.startsWith('constant.numeric'))),
    ).toBeDefined();
    expect(
      flat.find((t) => t.text === '25.f' && t.scopes.some((s) => s.startsWith('constant.numeric'))),
    ).toBeDefined();
    // Member access on an int must NOT be eaten: `25.foo()` splits as 25 + .foo
    // — every dot branch rejects a `.` followed by identifier chars (negative
    // lookahead or digit-only tails), so the bare-int branch matches the
    // leading `25` and `.foo` tokenizes separately as member access.
    // (Line-scoped: the corpus's legit `float f3 = 25.;` DOES produce a `25.`
    // numeric token, so we must only look at the member-access line.)
    const memberLine = tokens.findIndex((l) => l?.some((t) => t.text.includes('.foo(')));
    expect(memberLine).toBeGreaterThanOrEqual(0);
    const memberToks = tokens[memberLine]!;
    expect(
      memberToks.find(
        (t) => t.text === '25' && t.scopes.some((s) => s.startsWith('constant.numeric')),
      ),
      'bare int 25 stays its own token',
    ).toBeDefined();
    expect(
      memberToks.find(
        (t) => t.text === '25.' && t.scopes.some((s) => s.startsWith('constant.numeric')),
      ),
      '25.foo is not tokenized as trailing-dot float 25.',
    ).toBeUndefined();
  });

  it('highlights access modifiers as storage.modifier', async () => {
    const tokens = await tokenize();
    for (const kw of ['private', 'protected', 'final', 'override', 'shared']) {
      expect(
        scopeOf(tokens, kw)?.some((s) => s.startsWith('storage.modifier')),
        kw,
      ).toBe(true);
    }
  });

  it('highlights word operators and/or/not/is', async () => {
    const tokens = await tokenize();
    const line = tokens.findIndex((l) => l?.some((t) => t.text.includes('app.Initialized')));
    expect(line).toBeGreaterThanOrEqual(0);
    for (const w of ['and', 'or', 'not', 'is']) {
      const tok = tokens[line]!.filter((t) => t.text.trim() === w);
      expect(
        tok.length > 0 &&
          tok.every((t) => t.scopes.some((s) => s.includes('keyword.operator.logical.word'))),
        w,
      ).toBe(true);
    }
  });

  it('highlights :: as namespace punctuation', async () => {
    const tokens = await tokenize();
    expect(
      scopeOf(tokens, '::')?.some((s) => s.startsWith('punctuation.separator.namespace')),
    ).toBe(true);
  });

  it('highlights @ handles', async () => {
    const tokens = await tokenize();
    expect(scopeOf(tokens, '@')?.some((s) => s.includes('keyword.operator.handle'))).toBe(true);
  });
});
