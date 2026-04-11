// src/resolve.ts
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

  // 3. npm platform package
  const platformArch = safeGetPlatformArch();
  if (platformArch) {
    const specifier = `@openplanet-lsp/${platformArch}/package.json`;
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

  // Later branches added in the next task.
  throw new BinaryNotFoundError({ checkedLocations: checked });
}

function safeGetPlatformArch(): string | undefined {
  try {
    return getPlatformArch();
  } catch {
    return undefined;
  }
}
