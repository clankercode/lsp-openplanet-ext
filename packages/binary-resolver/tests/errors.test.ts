// tests/errors.test.ts
import { describe, it, expect } from 'vitest';
import { BinaryNotFoundError } from '../src/errors.js';

describe('BinaryNotFoundError', () => {
  it('is an instance of Error', () => {
    const err = new BinaryNotFoundError({ checkedLocations: [] });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BinaryNotFoundError');
  });

  it('exposes checkedLocations on the instance', () => {
    const locs = [
      { source: 'override' as const, path: '/bad/path', reason: 'file not found' },
      { source: 'vscode-bundle' as const, path: '/ext/bin/openplanet-lsp', reason: 'not set' },
    ];
    const err = new BinaryNotFoundError({ checkedLocations: locs });
    expect(err.checkedLocations).toEqual(locs);
  });

  it('builds a structured multi-line message listing every checked location', () => {
    const err = new BinaryNotFoundError({
      checkedLocations: [
        { source: 'override', path: '/bad/path', reason: 'file not found' },
        { source: 'npm-platform-pkg', path: '@openplanet-lsp/linux-x64', reason: 'not installed' },
      ],
    });
    expect(err.message).toContain('openplanet-lsp binary not found');
    expect(err.message).toContain('override');
    expect(err.message).toContain('/bad/path');
    expect(err.message).toContain('file not found');
    expect(err.message).toContain('npm-platform-pkg');
    expect(err.message).toContain('@openplanet-lsp/linux-x64');
  });

  it('handles empty checkedLocations without crashing', () => {
    const err = new BinaryNotFoundError({ checkedLocations: [] });
    expect(err.message).toContain('openplanet-lsp binary not found');
  });
});
