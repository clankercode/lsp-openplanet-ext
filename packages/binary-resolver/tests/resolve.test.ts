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
    // Simulate a platform package at <tmp>/node_modules/openplanet-lsp-<platform-arch>/.
    // The published packages are UNSCOPED (openplanet-lsp-linux-x64 etc.) —
    // the @openplanet-lsp org assumed by the original design never existed.
    const { getPlatformArch, getBinaryName } = await import('../src/paths.js');
    const pkgDir = join(tmp, 'node_modules', `openplanet-lsp-${getPlatformArch()}`);
    mkdirSync(join(pkgDir, 'bin'), { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: `openplanet-lsp-${getPlatformArch()}` }),
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

  it('asks the module resolver for the unscoped platform package specifier', async () => {
    // Regression guard: the resolver must request openplanet-lsp-<platform-arch>,
    // NOT @openplanet-lsp/<platform-arch> — only the unscoped packages are
    // published to npm (scoped name 404s).
    const { getPlatformArch } = await import('../src/paths.js');
    const specifiers: string[] = [];
    await resolveBinary({
      _platformPackageResolver: (specifier: string) => {
        specifiers.push(specifier);
        throw new Error('MODULE_NOT_FOUND');
      },
    } as never).catch(() => {
      // expected to throw BinaryNotFoundError
    });
    expect(specifiers).toContain(`openplanet-lsp-${getPlatformArch()}/package.json`);
    expect(specifiers.join('\n')).not.toContain('@openplanet-lsp/');
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

describe('resolveBinary — PATH fallback', () => {
  let tmp: string;
  let originalPath: string | undefined;
  let originalAllowPath: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'resolve-path-'));
    originalPath = process.env.PATH;
    originalAllowPath = process.env.OPENPLANET_LSP_ALLOW_PATH;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    process.env.PATH = originalPath;
    if (originalAllowPath === undefined) delete process.env.OPENPLANET_LSP_ALLOW_PATH;
    else process.env.OPENPLANET_LSP_ALLOW_PATH = originalAllowPath;
  });

  it('does NOT search PATH when OPENPLANET_LSP_ALLOW_PATH is unset', async () => {
    delete process.env.OPENPLANET_LSP_ALLOW_PATH;
    // Plant a fake binary in tmp and put tmp on PATH.
    const { getBinaryName } = await import('../src/paths.js');
    const bin = join(tmp, getBinaryName());
    writeFileSync(bin, '');
    chmodSync(bin, 0o755);
    process.env.PATH = tmp;
    // With no override/extensionPath/platform pkg, the resolver should throw — not find this.
    await expect(
      resolveBinary({
        _platformPackageResolver: () => {
          throw new Error('MODULE_NOT_FOUND');
        },
      } as never),
    ).rejects.toThrow(BinaryNotFoundError);
  });

  it('searches PATH when OPENPLANET_LSP_ALLOW_PATH=1', async () => {
    process.env.OPENPLANET_LSP_ALLOW_PATH = '1';
    const { getBinaryName } = await import('../src/paths.js');
    const bin = join(tmp, getBinaryName());
    writeFileSync(bin, '');
    chmodSync(bin, 0o755);
    process.env.PATH = tmp;
    const result = await resolveBinary({
      _platformPackageResolver: () => {
        throw new Error('MODULE_NOT_FOUND');
      },
    } as never);
    expect(result.path).toBe(bin);
    expect(result.source).toBe('path');
  });

  it('lists every checked source in the BinaryNotFoundError when everything fails', async () => {
    delete process.env.OPENPLANET_LSP_ALLOW_PATH;
    try {
      await resolveBinary({
        extensionPath: tmp,
        _platformPackageResolver: () => {
          throw new Error('MODULE_NOT_FOUND');
        },
      } as never);
      throw new Error('should have thrown');
    } catch (err) {
      const e = err as BinaryNotFoundError;
      const sources = e.checkedLocations.map((l) => l.source);
      expect(sources).toContain('vscode-bundle');
      expect(sources).toContain('npm-platform-pkg');
      // PATH not in the list because it's disabled by default.
      expect(sources).not.toContain('path');
    }
  });
});
