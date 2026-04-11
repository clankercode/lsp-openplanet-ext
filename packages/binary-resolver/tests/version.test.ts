// tests/version.test.ts
import { describe, it, expect } from 'vitest';
import { parseVersion } from '../src/version.js';

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
