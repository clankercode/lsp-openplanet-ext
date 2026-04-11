export type PlatformArch =
  | 'linux-x64'
  | 'linux-arm64'
  | 'darwin-x64'
  | 'darwin-arm64'
  | 'win32-x64'
  | 'win32-arm64';

const SUPPORTED: ReadonlySet<string> = new Set([
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
]);

export function getPlatformArch(): PlatformArch {
  const key = `${process.platform}-${process.arch}`;
  if (!SUPPORTED.has(key)) {
    throw new Error(
      `unsupported platform/arch combination: ${key}. ` + `Supported: ${[...SUPPORTED].join(', ')}`,
    );
  }
  return key as PlatformArch;
}

export function getBinaryName(): string {
  return process.platform === 'win32' ? 'openplanet-lsp.exe' : 'openplanet-lsp';
}
