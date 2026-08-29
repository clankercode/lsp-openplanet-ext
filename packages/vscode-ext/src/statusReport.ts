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

import { abbreviateHomeInText } from './paths';
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
  /** Logical and physical home paths, so symlinked homes are both safe. */
  homeAliases?: readonly string[];
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
  const homes = input.homeAliases ?? (input.home ? [input.home] : []);
  const redact = (value: string | undefined) => abbreviateHomeInText(value, homes, input.platform);
  const redactAll = (values: readonly string[] | undefined): string[] =>
    (values ?? [])
      .filter((value) => value !== undefined && value !== null && value.trim() !== '')
      .map((value) => redact(value) as string);

  const lines: string[] = [
    '# Openplanet LSP status',
    '',
    'Paste this into a bug report. Home directories are shown as `~`.',
    '',
    '## Server',
    '',
    line('State', redact(input.state)),
  ];

  if (input.failureReason) {
    lines.push(line('Failure', redact(input.failureReason)));
  }

  lines.push(
    line('Binary', redact(input.serverPath)),
    line('Resolved via', redact(input.serverSource)),
    line('Version', redact(input.serverVersion)),
    ...typeDbLines(
      input.typeDb
        ? {
            ...input.typeDb,
            core: redact(input.typeDb.core),
            game: redact(input.typeDb.game),
            source: redact(input.typeDb.source),
          }
        : undefined,
    ),
    '',
    '## Configuration',
    '',
    line('Game target', redact(input.gameTarget), UNSET),
    line('Signature mode', redact(input.signatureMode), UNSET),
    line('Unused level', redact(input.unused), UNSET),
    line('Inactive regions', redact(input.inactiveRegions), UNSET),
    listLine('Extra defines', redactAll(input.defines)),
    listLine('Plugin roots', redactAll(input.pluginRoots)),
    '',
    '## Workspace',
    '',
    listLine('Folders', redactAll(input.workspaceFolders)),
    line('Active editor root', redact(input.activeWorkspaceRoot), NONE),
    '',
    '## Environment',
    '',
    line('Extension', redact(input.extensionVersion)),
    line('VS Code', redact(input.vscodeVersion)),
    line('Platform', redact(input.platform)),
  );

  return lines.join('\n') + '\n';
}
