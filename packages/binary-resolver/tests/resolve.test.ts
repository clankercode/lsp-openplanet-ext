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
