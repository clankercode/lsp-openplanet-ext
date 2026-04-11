// tests/version.test.ts
import { describe, it, expect } from 'vitest';
import { parseVersion, checkBinaryVersion } from '../src/version.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureOk = join(here, 'fixtures', 'fake-binary-ok.mjs');
const fixtureBad = join(here, 'fixtures', 'fake-binary-bad.mjs');

describe('parseVersion', () => {
  it('parses the canonical openplanet-lsp output', () => {
    expect(parseVersion('openplanet-lsp 0.2.0')).toBe('0.2.0');
  });

  it('trims surrounding whitespace and trailing newline', () => {
    expect(parseVersion('  openplanet-lsp 0.2.0\n')).toBe('0.2.0');
  });

  it('handles a v-prefix gracefully', () => {
    expect(parseVersion('openplanet-lsp v0.2.0')).toBe('0.2.0');
  });

  it('returns undefined for non-matching output', () => {
    expect(parseVersion('garbage')).toBeUndefined();
    expect(parseVersion('')).toBeUndefined();
  });

  it('returns undefined when the version token is missing', () => {
    expect(parseVersion('openplanet-lsp')).toBeUndefined();
  });

  it('extracts only the version even with a build suffix', () => {
    expect(parseVersion('openplanet-lsp 0.2.0-dev.1')).toBe('0.2.0-dev.1');
  });
});

describe('checkBinaryVersion', () => {
  it('reports ok=true when actual version equals expected', async () => {
    const result = await checkBinaryVersion(process.execPath, '0.2.0', [fixtureOk]);
    expect(result.ok).toBe(true);
    expect(result.actual).toBe('0.2.0');
    expect(result.expected).toBe('0.2.0');
  });

  it('reports ok=false when actual version differs from expected', async () => {
    const result = await checkBinaryVersion(process.execPath, '0.1.0', [fixtureOk]);
    expect(result.ok).toBe(false);
    expect(result.actual).toBe('0.2.0');
    expect(result.expected).toBe('0.1.0');
  });

  it('reports ok=false with actual="unknown" when output is unparseable', async () => {
    // Invoke a script that prints garbage
    const result = await checkBinaryVersion(process.execPath, '0.2.0', [
      '-e',
      "process.stdout.write('garbage')",
    ]);
    expect(result.ok).toBe(false);
    expect(result.actual).toBe('unknown');
  });

  it('throws if the binary path is unspawnable', async () => {
    await expect(
      checkBinaryVersion('/definitely/does/not/exist/openplanet-lsp', '0.2.0'),
    ).rejects.toThrow();
  });

  it('returns ok=false when binary exits non-zero', async () => {
    const result = await checkBinaryVersion(process.execPath, '0.2.0', [fixtureBad]);
    expect(result.ok).toBe(false);
    expect(result.actual).toBe('unknown');
  });
});
