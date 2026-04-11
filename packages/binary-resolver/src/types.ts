export type ResolveSource = 'override' | 'vscode-bundle' | 'npm-platform-pkg' | 'path';

export interface ResolveOptions {
  /** Explicit override; wins over everything if provided and the file exists. */
  override?: string;

  /**
   * For VSCode: path to the extension's install dir, containing bin/openplanet-lsp[.exe].
   * For npm: not used.
   */
  extensionPath?: string;

  /** Optional logger so callers can see why a particular path was chosen. */
  log?: (msg: string) => void;
}

export interface ResolveResult {
  /** Absolute path to the binary; verified to exist. */
  path: string;
  /** Which branch of the resolver produced this path. */
  source: ResolveSource;
  /** Result of parsing `<bin> --version`, if resolvable. Optional (not all callers need it). */
  version?: string;
}
