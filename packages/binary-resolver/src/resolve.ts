import { existsSync } from 'node:fs';
import type { ResolveOptions, ResolveResult } from './types.js';
import { BinaryNotFoundError, type CheckedLocation } from './errors.js';

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

  // Later branches added in subsequent tasks.
  throw new BinaryNotFoundError({ checkedLocations: checked });
}
