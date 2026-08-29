/**
 * Status-bar presentation for the language server's lifecycle (B043).
 *
 * Pure (no `vscode` import): this maps state -> what the item should show, so
 * every state can be asserted without an extension host. `extension.ts` owns
 * the StatusBarItem and copies these fields onto it.
 *
 * The status bar deliberately does NOT poll. Everything here is driven by
 * `LanguageClient.onDidChangeState` plus the one-shot probes taken when a
 * server starts — a per-second refresh of a mostly-static indicator is wasted
 * work in every open window.
 */

export type ServerState = 'starting' | 'ready' | 'restarting' | 'failed';

export interface TypeDbInfo {
  /** Openplanet version the core DB was generated from, e.g. "1.29.5". */
  core?: string;
  /** Openplanet version of the game DB. */
  game?: string;
  /** Directory the DBs were read from (already home-abbreviated). */
  source?: string;
}

export interface StatusInfo {
  state: ServerState;
  /** Resolved server binary (already home-abbreviated). */
  serverPath?: string;
  serverVersion?: string;
  typeDb?: TypeDbInfo;
  gameTarget?: string;
  /** Workspace root for the ACTIVE editor (already home-abbreviated). */
  workspaceRoot?: string;
  /** Why the server failed. The whole point of the indicator. */
  failureReason?: string;
}

export interface StatusBarRender {
  text: string;
  tooltip: string;
  ariaLabel: string;
  /**
   * ThemeColor id for the item background; undefined means the default
   * status-bar background.
   */
  backgroundColorId?: string;
}

/** VS Code's built-in error background for status bar items. */
export const ERROR_BACKGROUND = 'statusBarItem.errorBackground';

/** Shown when a value could not be determined, rather than an empty line. */
export const UNKNOWN = 'unknown';

const LABEL = 'Openplanet';

/**
 * Each state gets a distinct icon AND distinct text: an icon-only difference
 * is invisible to anyone who has icons rendered small or is reading a
 * screenshot in a bug report.
 */
const STATE_TEXT: Record<ServerState, string> = {
  starting: `$(sync~spin) ${LABEL}: starting`,
  ready: `$(check) ${LABEL}`,
  restarting: `$(sync~spin) ${LABEL}: restarting`,
  failed: `$(error) ${LABEL}: failed`,
};

const STATE_SUMMARY: Record<ServerState, string> = {
  starting: 'Starting the language server',
  ready: 'Language server ready',
  restarting: 'Restarting the language server',
  failed: 'Language server failed to start',
};

/** True for states the user should be able to spot without reading text. */
export function isFailureState(state: ServerState): boolean {
  return state === 'failed';
}

function orUnknown(v: string | undefined): string {
  return v !== undefined && v.trim() !== '' ? v : UNKNOWN;
}

function typeDbLine(db: TypeDbInfo | undefined): string {
  if (!db || (db.core === undefined && db.game === undefined)) return UNKNOWN;
  const parts: string[] = [];
  if (db.core !== undefined) parts.push(`core ${db.core}`);
  if (db.game !== undefined) parts.push(`game ${db.game}`);
  const versions = parts.join(', ');
  return db.source ? `${versions} (${db.source})` : versions;
}

/**
 * Build the text/tooltip/colour for a status bar item.
 *
 * The tooltip carries everything a support conversation opens with — which
 * binary, which version, which type DB, which game target, which root — so
 * "is it even running, and running as what" is answerable by hovering.
 */
export function renderStatusBar(info: StatusInfo): StatusBarRender {
  const lines: string[] = [`Openplanet LSP - ${STATE_SUMMARY[info.state]}`];

  if (info.state === 'failed' && info.failureReason) {
    lines.push('', `Reason: ${info.failureReason}`);
  }

  lines.push(
    '',
    `Server:      ${orUnknown(info.serverPath)}`,
    `Version:     ${orUnknown(info.serverVersion)}`,
    `Type DB:     ${typeDbLine(info.typeDb)}`,
    `Game target: ${orUnknown(info.gameTarget)}`,
    `Workspace:   ${orUnknown(info.workspaceRoot)}`,
    '',
    'Click to open the Openplanet LSP log.',
  );

  return {
    text: STATE_TEXT[info.state],
    tooltip: lines.join('\n'),
    ariaLabel: `Openplanet LSP: ${STATE_SUMMARY[info.state]}`,
    backgroundColorId: isFailureState(info.state) ? ERROR_BACKGROUND : undefined,
  };
}
