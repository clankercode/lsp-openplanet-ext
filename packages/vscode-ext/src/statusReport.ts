/**
 * The `openplanetLsp.showStatus` document (B043).
 *
 * Pure (no `vscode` import) so the exact text can be asserted.
 *
 * This is a bug-report aid: assume every line ends up pasted into a public
 * GitHub issue. So paths are home-abbreviated to `~` and NOTHING is read out
 * of the environment wholesale — only the specific, named settings below.
 * Adding a field here is adding it to a public paste.
 */

import { abbreviateAll, abbreviateHome } from './paths';
import type { ServerState, TypeDbInfo } from './status';

export interface StatusReportInput {
  state: ServerState;
  failureReason?: string;
  /** Raw resolved server binary path; abbreviated here. */
  serverPath?: string;
  /** How the binary was chosen: setting override / bundled / PATH. */
  serverSource?: string;
  serverVersion?: string;
  typeDb?: TypeDbInfo;
  gameTarget?: string;
  signatureMode?: string;
  unused?: string;
  inactiveRegions?: string;
  defines?: readonly string[];
  /** Raw plugin-root paths; abbreviated here. */
  pluginRoots?: readonly string[];
  /** Raw workspace folder paths; abbreviated here. */
  workspaceFolders?: readonly string[];
  /** Workspace folder owning the active editor, raw; abbreviated here. */
  activeWorkspaceRoot?: string;
  extensionVersion?: string;
  vscodeVersion?: string;
  platform?: string;
  /** Injected so tests do not depend on the runner's home directory. */
  home?: string;
}

const UNSET = '(unset)';
const UNKNOWN = 'unknown';
const NONE = '(none)';

function line(label: string, value: string | undefined, fallback = UNKNOWN): string {
  return `- ${label}: ${value !== undefined && value.trim() !== '' ? value : fallback}`;
}

function listLine(label: string, values: readonly string[]): string {
  return `- ${label}: ${values.length > 0 ? values.join(', ') : NONE}`;
}

function typeDbLines(db: TypeDbInfo | undefined): string[] {
  if (!db) return [line('Type DB', undefined)];
  return [
    line('Type DB (core)', db.core),
    line('Type DB (game)', db.game),
    line('Type DB source', db.source),
  ];
}

/**
 * Render the status document.
 *
 * Markdown so it is readable both in the editor and once pasted into an
 * issue. Deliberately no code fences around the whole thing: people paste
 * this INTO a fenced block.
 */
export function buildStatusReport(input: StatusReportInput): string {
  const home = input.home;
  const abbr = (p: string | undefined) => abbreviateHome(p, home, input.platform);

  const lines: string[] = [
    '# Openplanet LSP status',
    '',
    'Paste this into a bug report. Home directories are shown as `~`.',
    '',
    '## Server',
    '',
    line('State', input.state),
  ];

  if (input.failureReason) {
    lines.push(line('Failure', input.failureReason));
  }

  lines.push(
    line('Binary', abbr(input.serverPath)),
    line('Resolved via', input.serverSource),
    line('Version', input.serverVersion),
    ...typeDbLines(
      input.typeDb ? { ...input.typeDb, source: abbr(input.typeDb.source) } : undefined,
    ),
    '',
    '## Configuration',
    '',
    line('Game target', input.gameTarget, UNSET),
    line('Signature mode', input.signatureMode, UNSET),
    line('Unused level', input.unused, UNSET),
    line('Inactive regions', input.inactiveRegions, UNSET),
    listLine('Extra defines', [...(input.defines ?? [])]),
    listLine('Plugin roots', abbreviateAll(input.pluginRoots, home, input.platform)),
    '',
    '## Workspace',
    '',
    listLine('Folders', abbreviateAll(input.workspaceFolders, home, input.platform)),
    line('Active editor root', abbr(input.activeWorkspaceRoot), NONE),
    '',
    '## Environment',
    '',
    line('Extension', input.extensionVersion),
    line('VS Code', input.vscodeVersion),
    line('Platform', input.platform),
  );

  return lines.join('\n') + '\n';
}
