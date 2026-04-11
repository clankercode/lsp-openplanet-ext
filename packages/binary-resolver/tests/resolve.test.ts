import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBinary } from '../src/resolve.js';
import { BinaryNotFoundError } from '../src/errors.js';

describe('resolveBinary — override source', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'resolve-test-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns the override path when it exists', async () => {
    const bin = join(tmp, 'openplanet-lsp');
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);
    const result = await resolveBinary({ override: bin });
    expect(result.path).toBe(bin);
    expect(result.source).toBe('override');
  });

  it('throws BinaryNotFoundError when the override path is set but missing', async () => {
    const bin = join(tmp, 'missing-binary');
    await expect(resolveBinary({ override: bin })).rejects.toThrow(BinaryNotFoundError);
  });

  it('does not fall through to other sources when override is invalid', async () => {
    const bin = join(tmp, 'missing-binary');
    try {
      await resolveBinary({ override: bin });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BinaryNotFoundError);
      const e = err as BinaryNotFoundError;
      expect(e.checkedLocations).toHaveLength(1);
      expect(e.checkedLocations[0]?.source).toBe('override');
    }
  });

  it('invokes the log callback with the resolution source', async () => {
    const bin = join(tmp, 'openplanet-lsp');
    writeFileSync(bin, '');
    chmodSync(bin, 0o755);
    const logs: string[] = [];
    await resolveBinary({ override: bin, log: (m) => logs.push(m) });
    expect(logs.join('\n')).toContain('override');
  });
});

describe('resolveBinary — vscode-bundle source', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'resolve-vscode-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves to <extensionPath>/bin/openplanet-lsp when present', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(tmp, 'bin'));
    const binName = process.platform === 'win32' ? 'openplanet-lsp.exe' : 'openplanet-lsp';
    const bin = join(tmp, 'bin', binName);
    writeFileSync(bin, '');
    chmodSync(bin, 0o755);
    const result = await resolveBinary({ extensionPath: tmp });
    expect(result.path).toBe(bin);
    expect(result.source).toBe('vscode-bundle');
  });

  it('falls through to later sources (or throws) when the vscode bin is missing', async () => {
    // No bin/ directory exists.
    await expect(resolveBinary({ extensionPath: tmp })).rejects.toThrow(BinaryNotFoundError);
  });

  it('records the vscode-bundle miss in checkedLocations', async () => {
    try {
      await resolveBinary({ extensionPath: tmp });
      throw new Error('should have thrown');
    } catch (err) {
      const e = err as BinaryNotFoundError;
      expect(e.checkedLocations.some((l) => l.source === 'vscode-bundle')).toBe(true);
    }
  });
});

describe('resolveBinary — npm-platform-pkg source', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'resolve-npm-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves to the binary inside a fake platform package', async () => {
    const { mkdirSync } = await import('node:fs');
    // Simulate a platform package at <tmp>/@openplanet-lsp/<platform-arch>/
    const { getPlatformArch, getBinaryName } = await import('../src/paths.js');
    const pkgDir = join(tmp, '@openplanet-lsp', getPlatformArch());
    mkdirSync(join(pkgDir, 'bin'), { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: `@openplanet-lsp/${getPlatformArch()}` }),
    );
    const bin = join(pkgDir, 'bin', getBinaryName());
    writeFileSync(bin, '');
    chmodSync(bin, 0o755);

    // resolveFromPlatformPackage accepts a resolver shim in tests
    const result = await resolveBinary({
      _platformPackageResolver: () => join(pkgDir, 'package.json'),
    } as never);
    expect(result.path).toBe(bin);
    expect(result.source).toBe('npm-platform-pkg');
  });

  it('records a miss when the platform package is absent', async () => {
    try {
      await resolveBinary({
        _platformPackageResolver: () => {
          throw new Error('MODULE_NOT_FOUND');
        },
      } as never);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BinaryNotFoundError);
      const e = err as BinaryNotFoundError;
      expect(e.checkedLocations.some((l) => l.source === 'npm-platform-pkg')).toBe(true);
    }
  });
});
