import { describe, expect, it } from 'vitest';
import { parseTypeDbJson, parseTypeDbText, parseVersion } from '../src/serverProbe';

describe('parseVersion', () => {
  it('parses the canonical form', () => {
    expect(parseVersion('openplanet-lsp 0.5.0\n')).toBe('0.5.0');
  });

  it('strips a v prefix', () => {
    expect(parseVersion('openplanet-lsp v0.5.0')).toBe('0.5.0');
  });

  it('keeps a build suffix', () => {
    expect(parseVersion('openplanet-lsp 0.5.0-rc.1+abc')).toBe('0.5.0-rc.1+abc');
  });

  it('returns undefined for output from some other binary', () => {
    expect(parseVersion('GNU bash, version 5.2')).toBeUndefined();
    expect(parseVersion('openplanet-lsp')).toBeUndefined();
    expect(parseVersion('')).toBeUndefined();
    expect(parseVersion('   \n  ')).toBeUndefined();
  });
});

describe('parseTypeDbJson', () => {
  // Captured verbatim from `openplanet-lsp typedb status --json`.
  const real = `{
  "core": {
    "counts": { "classes": 75 },
    "mp": null,
    "op": "1.29.5 (next, Public, 1234ad9e)",
    "path": "/home/max/OpenplanetNext/OpenplanetCore.json"
  },
  "game": {
    "counts": { "classes": 2585 },
    "mp": "2026-02-03 03:51:19",
    "op": "1.29.5",
    "path": "/home/max/OpenplanetNext/OpenplanetNext.json"
  }
}`;

  it('reads both version stamps and the directory', () => {
    expect(parseTypeDbJson(real)).toEqual({
      core: '1.29.5 (next, Public, 1234ad9e)',
      game: '1.29.5',
      source: '/home/max/OpenplanetNext',
    });
  });

  it('tolerates a log line before the JSON', () => {
    expect(parseTypeDbJson(`some warning\n${real}`)?.core).toContain('1.29.5');
  });

  it('handles a half-populated status', () => {
    const out = parseTypeDbJson('{"core": {"op": "1.29.5", "path": "/a/b/c.json"}, "game": null}');
    expect(out).toEqual({ core: '1.29.5', game: undefined, source: '/a/b' });
  });

  it('returns undefined for non-JSON and for JSON of the wrong shape', () => {
    expect(parseTypeDbJson('not json at all')).toBeUndefined();
    expect(parseTypeDbJson('{ "core": ')).toBeUndefined();
    expect(parseTypeDbJson('{"unrelated": 1}')).toBeUndefined();
    expect(parseTypeDbJson('[1,2,3]')).toBeUndefined();
  });

  it('handles windows paths', () => {
    expect(
      parseTypeDbJson('{"core":{"op":"1.0","path":"C:\\\\Users\\\\m\\\\Op\\\\Core.json"}}'),
    ).toEqual({ core: '1.0', game: undefined, source: 'C:\\Users\\m\\Op' });
  });
});

describe('parseTypeDbText (fallback for servers without --json)', () => {
  const real = [
    'core:  /home/max/OpenplanetNext/OpenplanetCore.json  op=1.29.5 (next, Public, 1234ad9e)  [854 functions]',
    'game:  /home/max/OpenplanetNext/OpenplanetNext.json  op=1.29.5  mp=2026-02-03 03:51:19  [2585 classes]',
  ].join('\n');

  it('reads both lines', () => {
    // The text format truncates the parenthesised core detail at the first
    // space; the JSON path is preferred precisely because of this.
    const out = parseTypeDbText(real);
    expect(out.core).toBe('1.29.5');
    expect(out.game).toBe('1.29.5');
    expect(out.source).toBe('/home/max/OpenplanetNext');
  });

  it('returns empty fields rather than throwing on junk', () => {
    expect(parseTypeDbText('nothing here')).toEqual({});
    expect(parseTypeDbText('')).toEqual({});
  });

  it('handles CRLF', () => {
    expect(parseTypeDbText(real.replace(/\n/g, '\r\n')).game).toBe('1.29.5');
  });
});
