import { describe, it, expect } from 'vitest';
import {
  resolveBinary,
  checkBinaryVersion,
  parseVersion,
  BinaryNotFoundError,
  getPlatformArch,
  getBinaryName,
} from '../src/index.js';
import type { ResolveOptions, ResolveResult, ResolveSource } from '../src/index.js';

describe('package index exports', () => {
  it('exports all public functions', () => {
    expect(typeof resolveBinary).toBe('function');
    expect(typeof checkBinaryVersion).toBe('function');
    expect(typeof parseVersion).toBe('function');
    expect(typeof getPlatformArch).toBe('function');
    expect(typeof getBinaryName).toBe('function');
  });

  it('exports BinaryNotFoundError as a constructable class', () => {
    const err = new BinaryNotFoundError({ checkedLocations: [] });
    expect(err).toBeInstanceOf(Error);
  });

  it('type imports compile (satisfies runtime check via void usage)', () => {
    const opts: ResolveOptions = { override: '/tmp/openplanet-lsp' };
    const result: Partial<ResolveResult> = { source: 'override' as ResolveSource };
    expect(opts.override).toBe('/tmp/openplanet-lsp');
    expect(result.source).toBe('override');
  });
});
