// src/resolve.ts
import { existsSync } from 'node:fs';
import { dirname, join, delimiter } from 'node:path';
import { createRequire } from 'node:module';
import type { ResolveOptions, ResolveResult } from './types.js';
import { BinaryNotFoundError, type CheckedLocation } from './errors.js';
import { getBinaryName, getPlatformArch } from './paths.js';

type InternalResolveOptions = ResolveOptions & {
  /** @internal test hatch — accepts a fake resolver that returns the package.json path. */
  _platformPackageResolver?: (specifier: string) => string;
};

const defaultResolver = (specifier: string): string => {
  const requireFn = createRequire(import.meta.url);
  return requireFn.resolve(specifier);
};

export async function resolveBinary(
  opts: ResolveOptions | InternalResolveOptions,
): Promise<ResolveResult> {
  const internal = opts as InternalResolveOptions;
  const log = internal.log ?? (() => {});
  const checked: CheckedLocation[] = [];
  const resolver = internal._platformPackageResolver ?? defaultResolver;

  // 1. Override
  if (internal.override !== undefined && internal.override !== '') {
    log(`trying override: ${internal.override}`);
    if (existsSync(internal.override)) {
      log(`resolved via override: ${internal.override}`);
      return { path: internal.override, source: 'override' };
    }
    checked.push({
      source: 'override',
      path: internal.override,
      reason: 'file not found (override is authoritative; not falling through)',
    });
    throw new BinaryNotFoundError({ checkedLocations: checked });
  }

  // 2. VSCode bundle
  if (internal.extensionPath !== undefined && internal.extensionPath !== '') {
    const candidate = join(internal.extensionPath, 'bin', getBinaryName());
    log(`trying vscode-bundle: ${candidate}`);
    if (existsSync(candidate)) {
      log(`resolved via vscode-bundle: ${candidate}`);
      return { path: candidate, source: 'vscode-bundle' };
    }
    checked.push({
      source: 'vscode-bundle',
      path: candidate,
      reason: 'file not found under extensionPath/bin/',
    });
  }

  // 3. npm platform package — unscoped names (openplanet-lsp-linux-x64 etc.);
  //    the @openplanet-lsp org assumed by the original design never existed,
  //    so a scoped specifier 404s against the published packages.
  const platformArch = safeGetPlatformArch();
  if (platformArch) {
    const specifier = `openplanet-lsp-${platformArch}/package.json`;
    log(`trying npm-platform-pkg: ${specifier}`);
    try {
      const manifestPath = resolver(specifier);
      const pkgDir = dirname(manifestPath);
      const candidate = join(pkgDir, 'bin', getBinaryName());
      if (existsSync(candidate)) {
        log(`resolved via npm-platform-pkg: ${candidate}`);
        return { path: candidate, source: 'npm-platform-pkg' };
      }
      checked.push({
        source: 'npm-platform-pkg',
        path: candidate,
        reason: 'platform package manifest resolved but binary is missing under bin/',
      });
    } catch (err) {
      checked.push({
        source: 'npm-platform-pkg',
        path: specifier,
        reason: `module resolution failed: ${(err as Error).message}`,
      });
    }
  } else {
    checked.push({
      source: 'npm-platform-pkg',
      path: '(unknown platform/arch)',
      reason: 'unsupported host platform/arch combination',
    });
  }

  // 4. PATH fallback — opt-in only
  if (process.env.OPENPLANET_LSP_ALLOW_PATH === '1') {
    const binName = getBinaryName();
    const entries = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
    log(`trying path: searching ${entries.length} PATH entries for ${binName}`);
    for (const dir of entries) {
      const candidate = join(dir, binName);
      if (existsSync(candidate)) {
        log(`resolved via path: ${candidate}`);
        return { path: candidate, source: 'path' };
      }
    }
    checked.push({
      source: 'path',
      path: binName,
      reason: `not found in any of ${entries.length} PATH entries`,
    });
  }

  // All branches exhausted.
  throw new BinaryNotFoundError({ checkedLocations: checked });
}

function safeGetPlatformArch(): string | undefined {
  try {
    return getPlatformArch();
  } catch {
    return undefined;
  }
}
