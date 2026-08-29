/**
 * Command-palette UI for `openplanetLsp.defines` (B034).
 *
 * The edit logic lives in `./defines` (pure, no `vscode`); everything here is
 * prompting, scope selection and the single settings write per invocation.
 *
 * ## One write per invocation
 *
 * `extension.ts` restarts the language server on any `openplanetLsp` config
 * change (the server reads settings only at `initialize`). So every command
 * here collects the user's whole intent first and calls `update` exactly once
 * — a write per toggled row would be a restart per toggled row.
 *
 * ## Scope
 *
 * Workspace is the default when a folder is open, because a define override
 * is almost always project-specific. Note that a VS Code array setting does
 * NOT merge across scopes, which `baseEntriesForScope` handles.
 *
 * ## Known limit: origins
 *
 * The manage view can only name origins it can prove. No server request
 * exposes the resolved define set with its winning config layer today, so the
 * rows are the user's own override entries and the origin reads
 * "user setting". The pure module already takes a resolved set and produces
 * minimal writes from it; wiring a future `openplanet-lsp/resolvedDefines`
 * request into `buildDefineRows` is the whole remaining change.
 */

import * as vscode from 'vscode';

import {
  applyDefineEdit,
  applyDefineEdits,
  baseEntriesForScope,
  buildDefineRows,
  describeOrigin,
  parseDefineEntries,
  parseDefineEntry,
  planClearOverrides,
  platformSelectorCaution,
  removeDefineEntries,
  validateDefineEntry,
  type DefineEdit,
  type DefineRow,
  type DefinesScope,
  type InspectedDefines,
} from './defines';

const SECTION = 'openplanetLsp';
const KEY = 'defines';

/** Writes one line to the extension's output channel, when there is one. */
export type Logger = (message: string) => void;

interface ScopeItem extends vscode.QuickPickItem {
  scope: DefinesScope;
}

interface RowItem extends vscode.QuickPickItem {
  row: DefineRow;
}

interface EntryItem extends vscode.QuickPickItem {
  /** The array element verbatim; removal is by exact match. */
  raw: string;
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

function inspectDefines(): InspectedDefines {
  const inspected = config().inspect<string[]>(KEY);
  return {
    globalValue: inspected?.globalValue,
    workspaceValue: inspected?.workspaceValue,
  };
}

/**
 * The configured game target, for the platform-selector guard. Read the same
 * way `readSettings()` does, so the guard judges against the value actually
 * forwarded to the server.
 */
function gameTarget(): string {
  return config().get<string>('gameTarget', 'TMNEXT');
}

function hasWorkspace(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

function scopeLabel(scope: DefinesScope): string {
  return scope === 'workspace' ? 'Workspace' : 'User';
}

/**
 * Ask which settings scope to edit.
 *
 * With no folder open there is nothing to ask — Workspace settings do not
 * exist — so the prompt is skipped and User is used.
 */
async function pickScope(action: string): Promise<DefinesScope | undefined> {
  if (!hasWorkspace()) return 'user';
  const items: ScopeItem[] = [
    {
      label: 'Workspace',
      description: 'this project only',
      detail: 'Recommended — a define override is usually specific to one plugin.',
      scope: 'workspace',
    },
    {
      label: 'User',
      description: 'every window',
      detail: 'Applies to every Openplanet workspace you open.',
      scope: 'user',
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: `${action}: which settings?`,
    placeHolder: 'Where should the override be written?',
  });
  return picked?.scope;
}

/**
 * The one settings write. Returns false when VS Code refuses it (for example
 * a workspace write with no workspace), so callers do not report success.
 */
async function writeDefines(
  scope: DefinesScope,
  value: string[] | undefined,
  log?: Logger,
): Promise<boolean> {
  const target =
    scope === 'workspace'
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  try {
    await config().update(KEY, value, target);
    log?.(`[defines] wrote ${scopeLabel(scope)} openplanetLsp.defines = ${JSON.stringify(value)}`);
    return true;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log?.(`[defines] failed to write ${scopeLabel(scope)} settings: ${detail}`);
    void vscode.window.showErrorMessage(
      `Could not update openplanetLsp.defines in ${scopeLabel(scope)} settings: ${detail}`,
    );
    return false;
  }
}

/** `NAME  •  on (user setting)` — the state and origin, greyed, per row. */
function rowItem(row: DefineRow, target: string): RowItem {
  const state = row.active ? 'on' : 'off';
  const base = row.entry
    ? `${state} — settings entry \`${row.entry}\``
    : `${state} — no entry in openplanetLsp.defines`;
  // Same GH #36 hazard as Add Define: a row for a foreign platform selector
  // turns off the target's own selectors while it is checked.
  const caution = platformSelectorCaution(row.name, target);
  const detail = caution ? `${base} · ⚠ ${caution}` : base;
  return {
    label: row.name,
    description: `${state} · ${describeOrigin(row.origin)}`,
    detail,
    picked: row.active,
    row,
  };
}

/**
 * Multi-select toggle list over the defines the extension can name.
 *
 * Checked = on. Unchecking writes the `-NAME` entry that turns a define off
 * rather than deleting the row, because "off" and "no opinion" are different
 * states in this array; **Remove Define** is the one that deletes entries.
 */
export async function manageDefines(log?: Logger): Promise<void> {
  const scope = await pickScope('Manage Defines');
  if (!scope) return;

  const entries = baseEntriesForScope(inspectDefines(), scope);
  const rows = buildDefineRows(entries);

  if (rows.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      `No define overrides in ${scopeLabel(scope)} settings yet. ` +
        'The defines derived from your game target, signature level and info.toml still apply.',
      'Add Define',
    );
    // Carry the scope through: the user has just answered that question.
    if (choice === 'Add Define') await addDefine(log, scope);
    return;
  }

  const target = gameTarget();
  const picked = await vscode.window.showQuickPick(
    rows.map((row) => rowItem(row, target)),
    {
      canPickMany: true,
      title: `Manage Defines (${scopeLabel(scope)} overrides)`,
      placeHolder:
        'Checked = on. Unchecking writes -NAME; use Remove Define to delete an entry instead.',
      matchOnDescription: true,
    },
  );
  if (!picked) return;

  const wantedOn = new Set(picked.map((item) => item.row.name));
  const edits: DefineEdit[] = rows
    .filter((row) => wantedOn.has(row.name) !== row.active)
    .map((row) => ({ name: row.name, on: !row.active, derivedOn: row.derivedOn }));
  if (edits.length === 0) return;

  await writeDefines(scope, applyDefineEdits(entries, edits), log);
}

/**
 * Input box → one appended (or replaced) entry.
 *
 * `presetScope` is passed when the caller has already asked, so chaining out
 * of **Manage Defines** does not put the same question twice in a row.
 */
export async function addDefine(log?: Logger, presetScope?: DefinesScope): Promise<void> {
  const typed = await vscode.window.showInputBox({
    title: 'Add Define',
    prompt:
      'Preprocessor define to add. Prefix with `-` to turn one off (e.g. -LOGS). ' +
      'Names are case sensitive.',
    placeHolder: 'MY_FLAG',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const issue = validateDefineEntry(value, gameTarget());
      if (!issue) return undefined;
      return {
        message: issue.message,
        severity:
          issue.severity === 'error'
            ? vscode.InputBoxValidationSeverity.Error
            : vscode.InputBoxValidationSeverity.Warning,
      };
    },
  });
  if (typed === undefined) return;

  const parsed = parseDefineEntry(typed);
  // Unreachable through the UI (the validator blocks it) but not through a
  // programmatic invocation of the command.
  if (!parsed) return;

  const scope = presetScope ?? (await pickScope('Add Define'));
  if (!scope) return;

  const entries = baseEntriesForScope(inspectDefines(), scope);
  // No derived state is known, so the entry states the wanted state outright.
  const next = applyDefineEdit(entries, { name: parsed.name, on: parsed.on });
  if (next.length === entries.length && next.every((entry, index) => entry === entries[index])) {
    return;
  }
  await writeDefines(scope, next, log);
}

/** QuickPick over the user's OWN entries; deletes the picked ones. */
export async function removeDefine(log?: Logger): Promise<void> {
  const scope = await pickScope('Remove Define');
  if (!scope) return;

  const entries = baseEntriesForScope(inspectDefines(), scope);
  const parsed = parseDefineEntries(entries);
  if (parsed.length === 0) {
    void vscode.window.showInformationMessage(
      `No define overrides in ${scopeLabel(scope)} settings to remove.`,
    );
    return;
  }

  const seen = new Map<string, number>();
  for (const entry of parsed) seen.set(entry.raw, (seen.get(entry.raw) ?? 0) + 1);
  const items: EntryItem[] = [...seen].map(([raw, count]) => {
    const { name, on } = parseDefineEntry(raw)!;
    return {
      label: raw,
      description: on ? `turns ${name} on` : `turns ${name} off`,
      detail: count > 1 ? `${count} identical entries — all are removed` : undefined,
      raw,
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: `Remove Define (${scopeLabel(scope)} overrides)`,
    placeHolder: 'Entries to delete from openplanetLsp.defines',
  });
  if (!picked || picked.length === 0) return;

  const next = removeDefineEntries(
    entries,
    picked.map((item) => item.raw),
  );
  await writeDefines(scope, next, log);
}

/** Empty the array back to the derived set, behind a modal confirm. */
export async function clearDefineOverrides(log?: Logger): Promise<void> {
  const scope = await pickScope('Clear Define Overrides');
  if (!scope) return;

  const inspected = inspectDefines();
  const plan = planClearOverrides(inspected, scope);
  if (plan.action === 'noop') {
    void vscode.window.showInformationMessage(
      `No define overrides in ${scopeLabel(scope)} settings to clear.`,
    );
    return;
  }

  const scopeValue = scope === 'workspace' ? inspected.workspaceValue : inspected.globalValue;
  const shadowed = scope === 'workspace' && scopeValue === undefined;
  const count = (shadowed ? inspected.globalValue : scopeValue)?.length ?? 0;
  const message = shadowed
    ? `Stop applying the ${count} define override(s) from your User settings in this ` +
      'Workspace? Defines fall back to the set derived from your game target, signature ' +
      'level and info.toml.'
    : `Clear ${count} define override(s) from ${scopeLabel(scope)} settings? Defines fall ` +
      'back to the set derived from your game target, signature level and info.toml.';

  const confirm = await vscode.window.showWarningMessage(message, { modal: true }, 'Clear');
  if (confirm !== 'Clear') return;

  await writeDefines(scope, plan.action === 'unset' ? undefined : [], log);
}

/** Contributed command ids, in palette order. */
export const DEFINES_COMMAND_IDS = [
  'openplanetLsp.defines.manage',
  'openplanetLsp.defines.add',
  'openplanetLsp.defines.remove',
  'openplanetLsp.defines.clearOverrides',
] as const;

/**
 * id → handler. `extension.ts` registers straight from this, so a command can
 * never be contributed in package.json without a handler behind it.
 */
export const DEFINES_COMMANDS: Record<
  (typeof DEFINES_COMMAND_IDS)[number],
  (log?: Logger) => Promise<void>
> = {
  'openplanetLsp.defines.manage': manageDefines,
  'openplanetLsp.defines.add': addDefine,
  'openplanetLsp.defines.remove': removeDefine,
  'openplanetLsp.defines.clearOverrides': clearDefineOverrides,
};
