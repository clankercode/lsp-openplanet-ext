import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Parses the output of `openplanet-lsp --version`.
 * Canonical form: "openplanet-lsp 0.2.0"
 * Also tolerates: leading/trailing whitespace, `v` prefix on the version, build suffixes.
 */
export function parseVersion(output: string): string | undefined {
  const trimmed = output.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return undefined;
  const raw = parts[1];
  if (!raw) return undefined;
  const stripped = raw.startsWith('v') ? raw.slice(1) : raw;
  if (!/^\d+\.\d+/.test(stripped)) return undefined;
  return stripped;
}

export interface VersionCheckResult {
  ok: boolean;
  actual: string;
  expected: string;
}

/**
 * Spawns `binaryPath --version` (or `binaryPath <extraArgs>` for testing)
 * and compares the parsed version to `expected`. Returns a structured result;
 * mismatch is ok=false, not thrown. Only spawn failures throw.
 */
export async function checkBinaryVersion(
  binaryPath: string,
  expected: string,
  extraArgs: readonly string[] = ['--version'],
): Promise<VersionCheckResult> {
  let stdout: string;
  try {
    const result = await execFileAsync(binaryPath, [...extraArgs], {
      timeout: 5_000,
      windowsHide: true,
    });
    stdout = result.stdout;
  } catch (err) {
    // Non-zero exit also lands here when using execFile with promisify.
    // Distinguish by whether the error is a spawn failure vs an exit.
    const e = err as NodeJS.ErrnoException & { code?: string | number };
    if (e.code === 'ENOENT' || e.code === 'EACCES') {
      throw err;
    }
    // Non-zero exit: return ok=false with unknown actual
    return { ok: false, actual: 'unknown', expected };
  }

  const actual = parseVersion(stdout) ?? 'unknown';
  return {
    ok: actual === expected,
    actual,
    expected,
  };
}
