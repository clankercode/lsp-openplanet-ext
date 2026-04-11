import { describe, it, expect } from 'vitest';
import { parseTag, checkAllVersionsMatch } from '../validate-release-tag.js';

describe('parseTag', () => {
  it('parses a plain semver tag', () => {
    expect(parseTag('v0.1.0')).toEqual({
      raw: 'v0.1.0',
      version: '0.1.0',
      baseVersion: '0.1.0',
      isDry: false,
      prerelease: null,
    });
  });

  it('parses v1.2.3 with multi-digit segments', () => {
    const info = parseTag('v10.20.30');
    expect(info.version).toBe('10.20.30');
    expect(info.baseVersion).toBe('10.20.30');
  });

  it('treats a -dry suffix as dry-run and strips it from baseVersion', () => {
    const info = parseTag('v0.1.0-dry');
    expect(info.isDry).toBe(true);
    expect(info.version).toBe('0.1.0-dry');
    expect(info.baseVersion).toBe('0.1.0');
    expect(info.prerelease).toBe('dry');
  });

  it('treats a -dry.N suffix as dry-run and strips the whole dry segment', () => {
    const info = parseTag('v0.1.0-dry.2');
    expect(info.isDry).toBe(true);
    expect(info.baseVersion).toBe('0.1.0');
    expect(info.prerelease).toBe('dry.2');
  });

  it('treats a -beta.N prerelease as a real prerelease (not dry)', () => {
    const info = parseTag('v0.2.0-beta.1');
    expect(info.isDry).toBe(false);
    expect(info.baseVersion).toBe('0.2.0-beta.1');
    expect(info.prerelease).toBe('beta.1');
  });

  it('rejects a tag without v prefix', () => {
    expect(() => parseTag('0.1.0')).toThrow(/must start with.*v/i);
  });

  it('rejects a non-semver tag', () => {
    expect(() => parseTag('v1.2')).toThrow(/semver/i);
    expect(() => parseTag('vX.Y.Z')).toThrow(/semver/i);
    expect(() => parseTag('v1.2.3.4')).toThrow(/semver/i);
  });

  it('rejects an empty tag', () => {
    expect(() => parseTag('')).toThrow();
  });
});

describe('checkAllVersionsMatch', () => {
  it('passes when every package.json version matches the base version', () => {
    const result = checkAllVersionsMatch('0.1.0', [
      { path: 'package.json', content: '{"version": "0.1.0"}' },
      { path: 'packages/a/package.json', content: '{"version": "0.1.0"}' },
      { path: 'packages/b/package.json', content: '{"version": "0.1.0"}' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.matchedFiles).toHaveLength(3);
  });

  it('reports the file path and both versions on a mismatch', () => {
    const result = checkAllVersionsMatch('0.1.0', [
      { path: 'package.json', content: '{"version": "0.0.0"}' },
      { path: 'packages/a/package.json', content: '{"version": "0.1.0"}' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('package.json');
    expect(result.errors[0]).toContain('0.0.0');
    expect(result.errors[0]).toContain('0.1.0');
  });

  it('reports a package.json without a version field', () => {
    const result = checkAllVersionsMatch('0.1.0', [
      { path: 'packages/x/package.json', content: '{"name": "x"}' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/no "version" field/);
  });

  it('reports invalid JSON with the file path', () => {
    const result = checkAllVersionsMatch('0.1.0', [
      { path: 'packages/x/package.json', content: 'not json' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('packages/x/package.json');
    expect(result.errors[0]).toMatch(/invalid JSON/);
  });

  it('accepts an empty file list as a trivial pass', () => {
    const result = checkAllVersionsMatch('0.1.0', []);
    expect(result.ok).toBe(true);
  });

  it('collects multiple errors across files', () => {
    const result = checkAllVersionsMatch('0.1.0', [
      { path: 'a/package.json', content: '{"version": "0.0.0"}' },
      { path: 'b/package.json', content: '{"version": "9.9.9"}' },
      { path: 'c/package.json', content: '{"version": "0.1.0"}' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.matchedFiles).toEqual(['c/package.json']);
  });
});
