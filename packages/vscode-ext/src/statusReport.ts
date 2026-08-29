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

/** A single rendered line: one label, one or more raw (un-redacted) values. */
interface Field {
  label: string;
  /** Rendered as a comma-joined list; empty means the fallback is used. */
  values: readonly (string | undefined)[];
  fallback?: string;
  /** Drop the line entirely when there is nothing to say. */
  omitWhenEmpty?: boolean;
}

interface Section {
  title: string;
  fields: Field[];
}

/**
 * Render one field, redacting here and ONLY here.
 *
 * This is the choke point. Every value in the document passes through this
 * function, so a field added to `sections` below cannot be shipped without
 * redaction - which is what went wrong four times when each call site
 * remembered (or forgot) to redact for itself.
 */
function renderField(
  field: Field,
  redact: (v: string | undefined) => string | undefined,
): string | undefined {
  const values = field.values
    .map(redact)
    .filter((v): v is string => v !== undefined && v.trim() !== '');
  if (values.length === 0) {
    if (field.omitWhenEmpty) return undefined;
    return `- ${field.label}: ${field.fallback ?? UNKNOWN}`;
  }
  return `- ${field.label}: ${values.join(', ')}`;
}

function typeDbFields(db: TypeDbInfo | undefined): Field[] {
  if (!db) return [{ label: 'Type DB', values: [] }];
  return [
    { label: 'Type DB (core)', values: [db.core] },
    { label: 'Type DB (game)', values: [db.game] },
    { label: 'Type DB source', values: [db.source] },
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

  const sections: Section[] = [
    {
      title: 'Server',
      fields: [
        { label: 'State', values: [input.state] },
        { label: 'Failure', values: [input.failureReason], omitWhenEmpty: true },
        { label: 'Binary', values: [input.serverPath] },
        { label: 'Resolved via', values: [input.serverSource] },
        { label: 'Version', values: [input.serverVersion] },
        ...typeDbFields(input.typeDb),
      ],
    },
    {
      title: 'Configuration',
      fields: [
        { label: 'Game target', values: [input.gameTarget], fallback: UNSET },
        { label: 'Signature mode', values: [input.signatureMode], fallback: UNSET },
        { label: 'Unused level', values: [input.unused], fallback: UNSET },
        { label: 'Inactive regions', values: [input.inactiveRegions], fallback: UNSET },
        { label: 'Extra defines', values: input.defines ?? [], fallback: NONE },
        { label: 'Plugin roots', values: input.pluginRoots ?? [], fallback: NONE },
      ],
    },
    {
      title: 'Workspace',
      fields: [
        { label: 'Folders', values: input.workspaceFolders ?? [], fallback: NONE },
        { label: 'Active editor root', values: [input.activeWorkspaceRoot], fallback: NONE },
      ],
    },
    {
      title: 'Environment',
      fields: [
        { label: 'Extension', values: [input.extensionVersion] },
        { label: 'VS Code', values: [input.vscodeVersion] },
        { label: 'Platform', values: [input.platform] },
      ],
    },
  ];

  const lines: string[] = [
    '# Openplanet LSP status',
    '',
    'Paste this into a bug report. Home directories are shown as `~`.',
  ];
  for (const section of sections) {
    lines.push('', `## ${section.title}`, '');
    for (const field of section.fields) {
      const rendered = renderField(field, redact);
      if (rendered !== undefined) lines.push(rendered);
    }
  }

  return lines.join('\n') + '\n';
}
