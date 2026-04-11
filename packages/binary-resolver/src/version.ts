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
