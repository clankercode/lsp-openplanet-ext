import { beforeEach, describe, expect, it } from 'vitest';

import * as fakeVscode from './mocks/vscode';
import {
  DEFINES_COMMAND_IDS,
  DEFINES_COMMANDS,
  addDefine,
  clearDefineOverrides,
  manageDefines,
  removeDefine,
} from '../src/definesCommands';

/**
 * Command-level tests for the defines UI (B034).
 *
 * `vscode` is aliased to ./mocks/vscode (vitest.config.ts), so these run the
 * real handlers against scripted QuickPick / InputBox / modal answers. What is
 * asserted is what a user would notice: which prompts appear, what lands in
 * settings, at which scope, and — the one that costs real time — that a whole
 * edit batch is ONE settings write and therefore one server restart.
 */

const KEY = 'openplanetLsp.defines';
const TARGET = fakeVscode.ConfigurationTarget;

interface PickItem {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
}

/** Answer the Workspace/User scope prompt. */
function queueScope(label: 'Workspace' | 'User'): void {
  fakeVscode.__queueQuickPick((items) => (items as PickItem[]).find((i) => i.label === label));
}

/** Answer a multi-select row picker by keeping the items `keep` accepts. */
function queuePicks(keep: (item: PickItem) => boolean): void {
  fakeVscode.__queueQuickPick((items) => (items as PickItem[]).filter(keep));
}

/** Answer a modal by pressing the named button. */
function queueButton(label: string): void {
  fakeVscode.__queueMessageResponse((_msg, items) => items.find((i) => i === label));
}

function updates(): fakeVscode.Recorded['configUpdates'] {
  return fakeVscode.recorded.configUpdates;
}

function lastWrite(): unknown {
  const all = updates();
  expect(all.length, 'expected a settings write').toBeGreaterThan(0);
  return all[all.length - 1].value;
}

/** Labels of the Nth QuickPick the command opened. */
function pickLabels(index = 0): string[] {
  const call = fakeVscode.recorded.quickPicks[index];
  expect(call, `no QuickPick at index ${index}`).toBeDefined();
  return (call.items as PickItem[]).map((i) => i.label);
}

beforeEach(() => {
  fakeVscode.__reset();
  fakeVscode.__setWorkspaceFolders(['/ws/my-plugin']);
});

describe('command table', () => {
  it('exposes exactly the four contributed ids', () => {
    expect(DEFINES_COMMAND_IDS).toEqual([
      'openplanetLsp.defines.manage',
      'openplanetLsp.defines.add',
      'openplanetLsp.defines.remove',
      'openplanetLsp.defines.clearOverrides',
    ]);
    expect(Object.keys(DEFINES_COMMANDS).sort()).toEqual([...DEFINES_COMMAND_IDS].sort());
  });
});

describe('scope prompt', () => {
  it('offers Workspace and User when a folder is open, defaulting to Workspace', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['DEV'] } });
    queueScope('Workspace');
    queuePicks(() => false);
    await manageDefines();
    // Workspace first: a define override is almost always project-specific.
    expect(pickLabels(0)).toEqual(['Workspace', 'User']);
  });

  it('skips the prompt and writes to User when no workspace is open', async () => {
    fakeVscode.__setWorkspaceFolders(undefined);
    fakeVscode.__setConfigScopes({ [KEY]: { globalValue: ['DEV'] } });
    queuePicks((i) => i.label !== 'DEV');
    await manageDefines();
    // Only the row picker was shown — no scope question.
    expect(fakeVscode.recorded.quickPicks).toHaveLength(1);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].target).toBe(TARGET.Global);
  });

  it('cancelling the scope prompt writes nothing', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['DEV'] } });
    fakeVscode.__queueQuickPick(() => undefined);
    await manageDefines();
    expect(updates()).toHaveLength(0);
  });
});

describe('manageDefines', () => {
  it('toggle_off_adds_minus_entry through the UI', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['DEV'] } });
    queueScope('Workspace');
    queuePicks(() => false); // unpick DEV
    await manageDefines();
    expect(lastWrite()).toEqual(['-DEV']);
  });

  it('toggle_back_on returns the array to its original contents', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['KEEP', '-DEV'] } });
    queueScope('Workspace');
    queuePicks(() => true); // pick everything: DEV back on
    await manageDefines();
    // DEV's derived state is unknown without server introspection, so the
    // honest write is an explicit `DEV`, not a silent removal that would
    // guess the base set.
    expect(lastWrite()).toEqual(['KEEP', 'DEV']);
  });

  it('shows the effective state of a contradictory array', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['DEV', '-DEV'] } });
    queueScope('Workspace');
    queuePicks(() => false);
    await manageDefines();
    const rows = fakeVscode.recorded.quickPicks[1].items as PickItem[];
    expect(rows).toHaveLength(1);
    // A remove beats an add server-side, so the row must read OFF.
    expect(rows[0].picked).toBe(false);
  });

  it('marks each row with its origin as the greyed description', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['DEV'] } });
    queueScope('Workspace');
    queuePicks(() => true);
    await manageDefines();
    const rows = fakeVscode.recorded.quickPicks[1].items as PickItem[];
    expect(rows[0].description).toContain('user setting');
  });

  it('flags a foreign platform selector row', async () => {
    fakeVscode.__setConfig({ 'openplanetLsp.gameTarget': 'TMNEXT' });
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['MP4', 'DEV'] } });
    queueScope('Workspace');
    queuePicks(() => true);
    await manageDefines();
    const rows = fakeVscode.recorded.quickPicks[1].items as PickItem[];
    const mp4 = rows.find((r) => r.label === 'MP4');
    const dev = rows.find((r) => r.label === 'DEV');
    expect(mp4?.detail).toContain('TMNEXT');
    expect(dev?.detail).not.toContain('TMNEXT');
  });

  it('writes ONCE for a whole batch, not once per toggled row', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['A', 'B', 'C'] } });
    queueScope('Workspace');
    queuePicks(() => false); // turn all three off
    await manageDefines();
    // Three toggles, one write — the extension restarts the server on a
    // config change, so one write per row would mean three restarts.
    expect(updates()).toHaveLength(1);
    expect(lastWrite()).toEqual(['-A', '-B', '-C']);
  });

  it('writes nothing when the picks match the current state', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['A', '-B'] } });
    queueScope('Workspace');
    queuePicks((i) => i.label === 'A');
    await manageDefines();
    expect(updates()).toHaveLength(0);
  });

  it('writes nothing when the row picker is dismissed', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['A'] } });
    queueScope('Workspace');
    fakeVscode.__queueQuickPick(() => undefined);
    await manageDefines();
    expect(updates()).toHaveLength(0);
  });

  it('offers to add one when there are no overrides yet', async () => {
    queueScope('Workspace');
    await manageDefines();
    expect(fakeVscode.recorded.quickPicks).toHaveLength(1); // scope only
    expect(fakeVscode.recorded.messages.at(-1)?.items).toContain('Add Define');
    expect(updates()).toHaveLength(0);
  });

  it('does not ask for the scope twice when chaining into Add Define', async () => {
    queueScope('Workspace');
    queueButton('Add Define');
    fakeVscode.__queueInputBox(() => 'MYFLAG');
    await manageDefines();
    // The user answered the scope question once, in Manage Defines; asking it
    // again on the way into Add Define is the same question twice.
    expect(fakeVscode.recorded.quickPicks).toHaveLength(1);
    expect(updates()).toEqual([
      { section: 'openplanetLsp', key: 'defines', value: ['MYFLAG'], target: TARGET.Workspace },
    ]);
  });
});

describe('scope isolation', () => {
  it('seeds a first workspace edit from the user value it will shadow', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { globalValue: ['USERFLAG'] } });
    queueScope('Workspace');
    queuePicks(() => false); // turn USERFLAG off
    await manageDefines();
    // Starting from [] would have silently dropped USERFLAG, because a
    // workspace array REPLACES the user one rather than merging with it.
    expect(lastWrite()).toEqual(['-USERFLAG']);
    expect(updates()[0].target).toBe(TARGET.Workspace);
  });

  it('a workspace write does not touch the user array', async () => {
    fakeVscode.__setConfigScopes({
      [KEY]: { globalValue: ['USERFLAG'], workspaceValue: ['WSFLAG'] },
    });
    queueScope('Workspace');
    queuePicks(() => false);
    await manageDefines();
    expect(updates()).toEqual([
      { section: 'openplanetLsp', key: 'defines', value: ['-WSFLAG'], target: TARGET.Workspace },
    ]);
  });

  it('a user write does not pull in workspace entries', async () => {
    fakeVscode.__setConfigScopes({
      [KEY]: { globalValue: ['USERFLAG'], workspaceValue: ['WSFLAG'] },
    });
    queueScope('User');
    queuePicks(() => false);
    await manageDefines();
    expect(pickLabels(1)).toEqual(['USERFLAG']);
    expect(lastWrite()).toEqual(['-USERFLAG']);
    expect(updates()[0].target).toBe(TARGET.Global);
  });
});

describe('addDefine', () => {
  it('appends the typed name', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['DEV'] } });
    fakeVscode.__queueInputBox(() => 'MYFLAG');
    queueScope('Workspace');
    await addDefine();
    expect(lastWrite()).toEqual(['DEV', 'MYFLAG']);
  });

  it('accepts a typed off entry in either negation form', async () => {
    for (const typed of ['-LOGS', '!LOGS']) {
      fakeVscode.__reset();
      fakeVscode.__setWorkspaceFolders(['/ws/my-plugin']);
      fakeVscode.__queueInputBox(() => typed);
      queueScope('Workspace');
      await addDefine();
      // Canonicalised to the dash form; `!` is an alias, not a second form.
      expect(lastWrite(), typed).toEqual(['-LOGS']);
    }
  });

  it('preserves case rather than upcasing', async () => {
    fakeVscode.__queueInputBox(() => 'dev');
    queueScope('Workspace');
    await addDefine();
    // `dev` and `DEV` are different defines to the server, so rewriting the
    // name would change what the user asked for.
    expect(lastWrite()).toEqual(['dev']);
  });

  it('collapses a re-add of a name already present', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['MYFLAG', 'MYFLAG'] } });
    fakeVscode.__queueInputBox(() => 'MYFLAG');
    queueScope('Workspace');
    await addDefine();
    expect(lastWrite()).toEqual(['MYFLAG']);
  });

  it('writes nothing when re-adding an already canonical entry', async () => {
    for (const entry of ['MYFLAG', '-LOGS']) {
      fakeVscode.__reset();
      fakeVscode.__setWorkspaceFolders(['/ws/my-plugin']);
      fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: [entry] } });
      fakeVscode.__queueInputBox(() => entry);
      queueScope('Workspace');
      await addDefine();
      expect(updates(), entry).toHaveLength(0);
    }
  });

  it('warns about a foreign platform selector without blocking the write', async () => {
    fakeVscode.__setConfig({ 'openplanetLsp.gameTarget': 'TMNEXT' });
    fakeVscode.__queueInputBox(() => 'MP4');
    queueScope('Workspace');
    await addDefine();

    const validate = fakeVscode.recorded.inputBoxes[0]?.validateInput;
    const issue = validate!('MP4');
    expect((issue as { severity: number }).severity).toBe(
      fakeVscode.InputBoxValidationSeverity.Warning,
    );
    expect((issue as { message: string }).message).toContain('TMNEXT');
    // Non-blocking: this is a footgun guard, not validation. The entry lands.
    expect(lastWrite()).toEqual(['MP4']);
  });

  it('does not warn about a selector in the configured target family', async () => {
    fakeVscode.__setConfig({ 'openplanetLsp.gameTarget': 'MP4' });
    fakeVscode.__queueInputBox(() => 'MP40');
    queueScope('Workspace');
    await addDefine();
    expect(fakeVscode.recorded.inputBoxes[0]?.validateInput!('MP40')).toBeUndefined();
    expect(lastWrite()).toEqual(['MP40']);
  });

  it('reads the game target from settings rather than assuming TMNEXT', async () => {
    fakeVscode.__setConfig({ 'openplanetLsp.gameTarget': 'MP4' });
    fakeVscode.__queueInputBox(() => 'TMNEXT');
    queueScope('Workspace');
    await addDefine();
    // TMNEXT is foreign once the target is MP4 — the guard must follow the
    // setting, not a hardcoded default.
    const issue = fakeVscode.recorded.inputBoxes[0]?.validateInput!('TMNEXT');
    expect((issue as { severity: number }).severity).toBe(
      fakeVscode.InputBoxValidationSeverity.Warning,
    );
  });

  it('writes nothing when the input box is dismissed', async () => {
    fakeVscode.__queueInputBox(() => undefined);
    await addDefine();
    expect(updates()).toHaveLength(0);
    expect(fakeVscode.recorded.quickPicks).toHaveLength(0); // no scope prompt either
  });

  it('wires the validator into the input box', async () => {
    fakeVscode.__queueInputBox(() => undefined);
    await addDefine();
    const validate = fakeVscode.recorded.inputBoxes[0]?.validateInput;
    expect(validate).toBeTypeOf('function');

    // Blocking severity for what the server would drop outright...
    const empty = validate!('   ');
    expect(empty).toBeTruthy();
    expect((empty as { severity: number }).severity).toBe(
      fakeVscode.InputBoxValidationSeverity.Error,
    );

    // ...non-blocking for a name the server keeps but no `#if` can name.
    const odd = validate!('MY DEFINE');
    expect((odd as { severity: number }).severity).toBe(
      fakeVscode.InputBoxValidationSeverity.Warning,
    );
    expect((odd as { message: string }).message).toContain('MY_DEFINE');

    expect(validate!('MYFLAG')).toBeUndefined();
  });
});

describe('removeDefine', () => {
  it('lists only the user’s own entries and removes the picked ones', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['A', '-B', 'C'] } });
    queueScope('Workspace');
    queuePicks((i) => i.label === '-B');
    await removeDefine();
    expect(pickLabels(1)).toEqual(['A', '-B', 'C']);
    expect(lastWrite()).toEqual(['A', 'C']);
  });

  it('says so and writes nothing when there is nothing to remove', async () => {
    queueScope('Workspace');
    await removeDefine();
    expect(fakeVscode.recorded.infos.at(-1)).toContain('No define overrides');
    expect(updates()).toHaveLength(0);
  });

  it('writes nothing when the picker is dismissed or nothing is picked', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['A'] } });
    queueScope('Workspace');
    fakeVscode.__queueQuickPick(() => undefined);
    await removeDefine();

    queueScope('Workspace');
    queuePicks(() => false);
    await removeDefine();

    expect(updates()).toHaveLength(0);
  });
});

describe('clearDefineOverrides', () => {
  it('confirms, then unsets the key when nothing would show through', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['A', '-B'] } });
    queueScope('Workspace');
    queueButton('Clear');
    await clearDefineOverrides();
    expect(fakeVscode.recorded.messages.at(-1)?.options).toMatchObject({ modal: true });
    expect(updates()).toEqual([
      { section: 'openplanetLsp', key: 'defines', value: undefined, target: TARGET.Workspace },
    ]);
  });

  it('writes an explicit empty array when a user value would reappear', async () => {
    fakeVscode.__setConfigScopes({
      [KEY]: { globalValue: ['USERFLAG'], workspaceValue: ['WSFLAG'] },
    });
    queueScope('Workspace');
    queueButton('Clear');
    await clearDefineOverrides();
    // Unsetting the workspace key would expose USERFLAG again, which is not
    // "back to the derived set".
    expect(lastWrite()).toEqual([]);
  });

  it('is a no-op with no error when there is nothing to clear', async () => {
    queueScope('Workspace');
    await clearDefineOverrides();
    expect(updates()).toHaveLength(0);
    expect(fakeVscode.recorded.errors).toHaveLength(0);
    expect(fakeVscode.recorded.infos.at(-1)).toContain('No define overrides');
  });

  it('is a no-op when the array is present but already empty', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: [] } });
    queueScope('Workspace');
    await clearDefineOverrides();
    expect(updates()).toHaveLength(0);
  });

  it('writes nothing when the confirmation is declined', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['A'] } });
    queueScope('Workspace');
    // No queued answer: the modal is dismissed.
    await clearDefineOverrides();
    expect(updates()).toHaveLength(0);
  });

  it('names the scope and the count in the confirmation', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['A', '-B'] } });
    queueScope('Workspace');
    queueButton('Clear');
    await clearDefineOverrides();
    const msg = fakeVscode.recorded.messages.at(-1)?.message ?? '';
    expect(msg).toContain('2');
    expect(msg.toLowerCase()).toContain('workspace');
  });
});
