import { describe, it, expect } from 'vitest';
import { verifyPackageShape } from '../verify-pkg-shape.js';

describe('verifyPackageShape', () => {
  it('passes on a well-formed workspace package', () => {
    const pkg = {
      name: 'binary-resolver',
      version: '0.0.0',
      type: 'module',
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
      files: ['dist'],
      scripts: { test: 'vitest run', typecheck: 'tsc --noEmit' },
    };
    const result = verifyPackageShape(pkg, 'packages/binary-resolver/package.json');
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports missing required fields', () => {
    const pkg = { name: 'foo' };
    const result = verifyPackageShape(pkg, 'packages/foo/package.json');
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/version/);
    expect(result.errors.join('\n')).toMatch(/scripts\.test/);
    expect(result.errors.join('\n')).toMatch(/scripts\.typecheck/);
  });

  it('reports when "type" is not "module"', () => {
    const pkg = {
      name: 'foo',
      version: '0.0.0',
      type: 'commonjs',
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
      files: ['dist'],
      scripts: { test: 'vitest run', typecheck: 'tsc --noEmit' },
    };
    const result = verifyPackageShape(pkg, 'packages/foo/package.json');
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/type.*module/);
  });
});
