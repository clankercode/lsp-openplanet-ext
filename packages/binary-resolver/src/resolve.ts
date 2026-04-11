// src/resolve.ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolveOptions, ResolveResult } from './types.js';
import { BinaryNotFoundError, type CheckedLocation } from './errors.js';
import { getBinaryName } from './paths.js';

export async function resolveBinary(opts: ResolveOptions): Promise<ResolveResult> {
  const log = opts.log ?? (() => {});
  const checked: CheckedLocation[] = [];

  // 1. Override
  if (opts.override !== undefined && opts.override !== '') {
    log(`trying override: ${opts.override}`);
    if (existsSync(opts.override)) {
      log(`resolved via override: ${opts.override}`);
      return { path: opts.override, source: 'override' };
    }
    checked.push({
      source: 'override',
      path: opts.override,
      reason: 'file not found (override is authoritative; not falling through)',
    });
    throw new BinaryNotFoundError({ checkedLocations: checked });
  }

  // 2. VSCode bundle
  if (opts.extensionPath !== undefined && opts.extensionPath !== '') {
    const candidate = join(opts.extensionPath, 'bin', getBinaryName());
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

  // Later branches added in subsequent tasks.
  throw new BinaryNotFoundError({ checkedLocations: checked });
}
