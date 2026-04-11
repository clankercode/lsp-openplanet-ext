import { describe, it, expect } from 'vitest';
import { parseVersion, bumpVersion, updatePackageJson } from '../bump-version.js';

describe('parseVersion', () => {
  it('parses a valid semver version', () => {
    const v = parseVersion('1.2.3');
    expect(v).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('rejects versions with non-numeric parts', () => {
    expect(() => parseVersion('1.2.x')).toThrow();
    expect(() => parseVersion('1.2')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => parseVersion('')).toThrow();
  });
});

describe('bumpVersion', () => {
  it('bumps major version', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  it('bumps minor version', () => {
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
  });

  it('bumps patch version', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
  });

  it('handles 0.x.y versions', () => {
    expect(bumpVersion('0.0.1', 'minor')).toBe('0.1.0');
  });
});

describe('updatePackageJson', () => {
  it('updates the version field in JSON', () => {
    const input = '{"name": "test", "version": "1.0.0"}';
    const result = updatePackageJson(input, '1.0.1');
    const parsed = JSON.parse(result);
    expect(parsed.version).toBe('1.0.1');
    expect(parsed.name).toBe('test');
  });

  it('preserves formatting for pretty JSON', () => {
    const input = '{\n  "name": "test",\n  "version": "1.0.0"\n}';
    const result = updatePackageJson(input, '1.0.1');
    expect(result).toContain('"version": "1.0.1"');
  });

  it('throws on invalid JSON', () => {
    expect(() => updatePackageJson('not json', '1.0.1')).toThrow();
  });
});
