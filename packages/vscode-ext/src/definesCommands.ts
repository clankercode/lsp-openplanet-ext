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
 * ## Origins
 *
 * The manage view names origins it can prove, and since B050 it can prove
 * most of them: `openplanet/resolvedDefines` returns the effective set with
 * an origin per entry, and {@link manageDefines} feeds that straight to
 * `buildDefineRows`. Rows the server derived (game target, signature level,
 * OS/arch, build shape, `info.toml`, resolved dependencies) are shown with
 * their real origin, alongside declared dependencies that did NOT resolve —
 * the rows that explain a dead `#if DEPENDENCY_X` branch.
 *
 * With no server answer the view falls back to B034's behaviour — the user's
 * own entries, origin "user setting" — and SAYS SO in the placeholder, which
 * is the part that was missing: the old view was a partial truth with no
 * indication it was partial.
 *
 * ## Derived rows are not entries
 *
 * A derived row is not editable as a settings entry, only as a state. Toggling
 * one off writes `-NAME` (an override that disables it); nothing in this file
 * can delete it, because there is nothing to delete — **Remove Define** lists
 * the user's own array elements, which a purely derived row does not have.
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
import { requestResolvedDefines, type ResolvedDefinesProvider } from './resolvedDefines';
import type { PlatformFamilies } from './settings';

const SECTION = 'openplanetLsp';
const KEY = 'defines';

/**
 * How these commands reach the language server (B050).
 *
 * Injected by `extension.ts` rather than imported, for two reasons: the client
 * is replaced on every restart, so a captured reference would go stale; and
 * this module would otherwise have to import `vscode-languageclient`, which
 * the unit tests do not stub.
 *
 * `undefined` — before the first start, and after `deactivate` — is a
 * supported state, not an error: the UI degrades to B034 behaviour.
 */
let introspect: ResolvedDefinesProvider | undefined;

/** Install (or, with `undefined`, remove) the introspection provider. */
export function setResolvedDefinesProvider(provider?: ResolvedDefinesProvider): void {
  introspect = provider;
}

/**
 * The document whose plugin workspace should answer. A multi-root window
 * serves one config PER root, so the interesting one is the root owning the
 * editor the user is looking at — the same rule `extension.ts` uses for the
 * status bar. Falls back to the first folder, then to no URI (the server's
 * window-wide config).
 */
function scopeUri(): string | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) return active.toString();
  return vscode.workspace.workspaceFolders?.[0]?.uri.toString();
}

/** The resolved set, or `undefined` when no server can answer. */
async function askServer(log?: Logger) {
  if (!introspect) return requestResolvedDefines(undefined, undefined, log);
  try {
    return await introspect(scopeUri());
  } catch (err) {
    // A provider must not reject, but a broken one must not take the command
    // down with it — the whole point of this path is that it is optional.
    log?.(`[defines] introspection provider failed: ${err instanceof Error ? err.message : err}`);
    return undefined;
  }
}

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

/** `NAME  •  on (game target)` — the state and origin, greyed, per row. */
function rowItem(row: DefineRow, target: string, families?: PlatformFamilies): RowItem {
  const state = row.active ? 'on' : 'off';
  // A row the server derived and the user has never touched has nothing to
  // delete — toggling it writes an override, it does not edit an entry. Say
  // that, so "no entry" does not read as "nothing here".
  const derivedOnly = row.entry === undefined && row.origin !== 'user';
  const base = row.entry
    ? `${state} — settings entry \`${row.entry}\``
    : derivedOnly
      ? `${state} — derived by the server; toggling writes an override`
      : `${state} — no entry in openplanetLsp.defines`;
  // Same GH #36 hazard as Add Define: a row for a foreign platform selector
  // turns off the target's own selectors while it is checked.
  const caution = platformSelectorCaution(row.name, target, families);
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
  // B050: the whole effective set when a server can answer, the user's own
  // entries when it cannot.
  const resolved = await askServer(log);
  const rows = buildDefineRows(entries, resolved?.defines);

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

  // The server's resolved target beats the setting: a workspace
  // `.openplanet-lsp.toml` can set a target the setting never mentions.
  const target = resolved?.gameTarget || gameTarget();
  const families = resolved?.platformFamilies;
  const picked = await vscode.window.showQuickPick(
    rows.map((row) => rowItem(row, target, families)),
    {
      canPickMany: true,
      title: resolved
        ? `Manage Defines (${scopeLabel(scope)} scope, ${target})`
        : `Manage Defines (${scopeLabel(scope)} overrides)`,
      placeHolder: resolved
        ? 'Checked = on. Unchecking writes -NAME; use Remove Define to delete an entry instead.'
        : 'Overrides only — the language server is not running, so derived defines are not listed.',
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
  // Fetched BEFORE the box opens: `validateInput` is synchronous, so the
  // guard can only use an answer that already arrived.
  const resolved = await askServer(log);
  const guardTarget = resolved?.gameTarget || gameTarget();
  const families = resolved?.platformFamilies;
  const derived = new Map(resolved?.defines.map((d) => [d.name, d.derivedActive]) ?? []);
  const typed = await vscode.window.showInputBox({
    title: 'Add Define',
    prompt:
      'Preprocessor define to add. Prefix with `-` to turn one off (e.g. -LOGS). ' +
      'Names are case sensitive.',
    placeHolder: 'MY_FLAG',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const issue = validateDefineEntry(value, guardTarget, families);
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
  // With a server answer the derived state is known, so adding a define that
  // is already derived-on writes NOTHING rather than a redundant entry
  // (`applyDefineEdit` drops it). Without one, `derivedOn` stays undefined
  // and the entry states the wanted state outright.
  const next = applyDefineEdit(entries, {
    name: parsed.name,
    on: parsed.on,
    derivedOn: derived.get(parsed.name),
  });
  if (next.length === entries.length && next.every((entry, index) => entry === entries[index])) {
    // Nothing to write. With a server answer that is usually because the
    // define is ALREADY in the wanted state without an override, and saying
    // so beats a silent no-op that reads like a failed command.
    const already = derived.get(parsed.name) === parsed.on;
    void vscode.window.showInformationMessage(
      already
        ? `\`${parsed.name}\` is already ${parsed.on ? 'on' : 'off'} without an override, ` +
            'so no setting was written.'
        : `openplanetLsp.defines already says that; nothing was written.`,
    );
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
