import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as fakeVscode from './mocks/vscode';
import {
  DEFINES_COMMAND_IDS,
  DEFINES_COMMANDS,
  addDefine,
  clearDefineOverrides,
  manageDefines,
  removeDefine,
  setDefine,
  setResolvedDefinesProvider,
} from '../src/definesCommands';
import type { ResolvedDefinesResult } from '../src/resolvedDefines';

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

describe('setDefine (B170 contextual code-action command)', () => {
  function resolved(name: string, active: boolean): ResolvedDefinesResult {
    return {
      root: '/ws/my-plugin',
      gameTarget: 'TMNEXT',
      platformFamilies: [['TMNEXT'], ['MP4', 'MP40', 'MP41'], ['TURBO']],
      defines: [
        {
          name,
          active,
          derivedActive: active,
          origins: [{ kind: 'gameTarget', detail: 'TMNEXT' }],
        },
      ],
    };
  }

  afterEach(() => setResolvedDefinesProvider(undefined));

  it('enables a derived-off define with one workspace write', async () => {
    setResolvedDefinesProvider(async () => resolved('DEV', false));
    queueScope('Workspace');
    await setDefine({ name: 'DEV', on: true });
    expect(lastWrite()).toEqual(['DEV']);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].target).toBe(TARGET.Workspace);
  });

  it('disables a derived-on define with the minimal negative override', async () => {
    setResolvedDefinesProvider(async () => resolved('DEV', true));
    queueScope('Workspace');
    await setDefine({ name: 'DEV', on: false });
    expect(lastWrite()).toEqual(['-DEV']);
  });

  it('canonicalizes explicit, negated, duplicate and contradictory entries in one edit', async () => {
    fakeVscode.__setConfigScopes({
      [KEY]: { workspaceValue: ['KEEP', '-DEV', 'DEV', 'DEV', '!DEV'] },
    });
    setResolvedDefinesProvider(async () => resolved('DEV', false));
    queueScope('Workspace');
    await setDefine({ name: 'DEV', on: true });
    expect(lastWrite()).toEqual(['KEEP', 'DEV']);

    fakeVscode.__setConfigScopes({
      [KEY]: { workspaceValue: ['KEEP', 'DEV', '-DEV', 'DEV'] },
    });
    setResolvedDefinesProvider(async () => resolved('DEV', true));
    queueScope('Workspace');
    await setDefine({ name: 'DEV', on: false });
    expect(lastWrite()).toEqual(['KEEP', '-DEV']);
  });

  it('preserves case and does not edit a differently-cased entry', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['DEV'] } });
    setResolvedDefinesProvider(async () => resolved('dev', false));
    queueScope('Workspace');
    await setDefine({ name: 'dev', on: true });
    expect(lastWrite()).toEqual(['DEV', 'dev']);
  });

  it('uses User scope without prompting when no workspace is open', async () => {
    fakeVscode.__setWorkspaceFolders(undefined);
    await setDefine({ name: 'DEV', on: true });
    expect(lastWrite()).toEqual(['DEV']);
    expect(updates()[0].target).toBe(TARGET.Global);
    expect(fakeVscode.recorded.quickPicks).toHaveLength(0);
  });

  it('writes nothing when scope selection is cancelled', async () => {
    fakeVscode.__queueQuickPick(() => undefined);
    await setDefine({ name: 'DEV', on: true });
    expect(updates()).toHaveLength(0);
  });

  it('rejects malformed command arguments without touching settings', async () => {
    for (const args of [
      undefined,
      {},
      { name: '', on: true },
      { name: '1DEV', on: true },
      { name: 'DEV' },
      { name: 'DEV', on: 1 },
    ]) {
      await setDefine(args);
    }
    expect(updates()).toHaveLength(0);
    expect(fakeVscode.recorded.quickPicks).toHaveLength(0);
  });

  it('requires confirmation for a foreign platform selector and cancellation writes nothing', async () => {
    setResolvedDefinesProvider(async () => resolved('MP4', false));
    await setDefine({ name: 'MP4', on: true });
    expect(updates()).toHaveLength(0);
    expect(fakeVscode.recorded.messages.at(-1)?.message).toContain('TMNEXT');

    queueButton('Continue');
    queueScope('Workspace');
    await setDefine({ name: 'MP4', on: true });
    expect(lastWrite()).toEqual(['MP4']);
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

/**
 * B050: the manage view driven by a real server answer.
 *
 * These are the tests that distinguish the shipped feature from a green unit
 * suite: they install an introspection provider (as `extension.ts` does) and
 * assert what the user then sees and what lands in settings.
 */
describe('manageDefines with server introspection', () => {
  /** The shape `openplanet/resolvedDefines` returns for a real plugin. */
  function serverAnswer(overrides: Partial<ResolvedDefinesResult> = {}): ResolvedDefinesResult {
    return {
      gameTarget: 'TMNEXT',
      platformFamilies: [['TMNEXT'], ['MP4', 'MP40', 'MP41'], ['TURBO']],
      defines: [
        { name: 'TMNEXT', active: true, origin: 'target', derivedActive: true },
        { name: 'SIG_DEVELOPER', active: true, origin: 'signature', derivedActive: true },
        { name: 'WINDOWS', active: true, origin: 'os', derivedActive: true },
        { name: 'MANIA64', active: true, origin: 'arch', derivedActive: true },
        { name: 'LOGS', active: true, origin: 'build', derivedActive: true },
        { name: 'FROM_MANIFEST', active: true, origin: 'manifest', derivedActive: true },
        {
          name: 'DEPENDENCY_MLHOOK',
          active: true,
          origin: 'dependency',
          derivedActive: true,
        },
        {
          name: 'DEPENDENCY_GONE',
          active: false,
          origin: 'dependency-missing',
          derivedActive: false,
        },
      ],
      ...overrides,
    };
  }

  /** Install the provider the way `extension.ts` does. */
  function serve(answer: ResolvedDefinesResult | undefined = serverAnswer()) {
    const calls: (string | undefined)[] = [];
    setResolvedDefinesProvider(async (uri) => {
      calls.push(uri);
      return answer;
    });
    return calls;
  }

  afterEach(() => setResolvedDefinesProvider(undefined));

  it('lists the derived set the user never typed', async () => {
    serve();
    queueScope('Workspace');
    queuePicks(() => true);
    await manageDefines();
    // The defect B050 fixes: none of these appear in openplanetLsp.defines,
    // and before introspection none of them could be shown at all.
    expect(pickLabels(1)).toEqual(
      expect.arrayContaining([
        'TMNEXT',
        'SIG_DEVELOPER',
        'WINDOWS',
        'MANIA64',
        'LOGS',
        'FROM_MANIFEST',
        'DEPENDENCY_MLHOOK',
        'DEPENDENCY_GONE',
      ]),
    );
  });

  it('names each derived origin instead of calling everything a user setting', async () => {
    serve();
    queueScope('Workspace');
    queuePicks(() => true);
    await manageDefines();
    const rows = fakeVscode.recorded.quickPicks[1].items as PickItem[];
    const describe_ = (name: string) => rows.find((r) => r.label === name)?.description ?? '';
    expect(describe_('TMNEXT')).toContain('game target');
    expect(describe_('SIG_DEVELOPER')).toContain('signature level');
    expect(describe_('WINDOWS')).toContain('host OS');
    expect(describe_('MANIA64')).toContain('architecture');
    expect(describe_('LOGS')).toContain('build shape');
    expect(describe_('FROM_MANIFEST')).toContain('info.toml');
    expect(describe_('DEPENDENCY_MLHOOK')).toContain('dependency');
  });

  it('shows an uninstalled dependency as an unchecked row, not as an absent one', async () => {
    serve();
    queueScope('Workspace');
    queuePicks(() => false);
    await manageDefines();
    const rows = fakeVscode.recorded.quickPicks[1].items as PickItem[];
    const gone = rows.find((r) => r.label === 'DEPENDENCY_GONE');
    // This row is the whole explanation for a dead `#if DEPENDENCY_GONE`
    // branch (B031). Omitting it would leave the user with no way to see why.
    expect(gone).toBeDefined();
    expect(gone?.picked).toBe(false);
    expect(gone?.description).toContain('not installed');
  });

  it('names the plugin the answer is scoped to in the title', async () => {
    serve(serverAnswer({ root: '/ws/my-plugin/alpha' }));
    queueScope('Workspace');
    queuePicks(() => true);
    await manageDefines();
    // A multi-root window has a DIFFERENT define set per plugin, so an
    // unlabelled list would be exactly the partial truth B050 exists to end.
    const title = fakeVscode.recorded.quickPicks[1].options?.title ?? '';
    expect(title).toContain('alpha');
    expect(title).toContain('TMNEXT');
  });

  it('omits the plugin name when the server did not scope the answer', async () => {
    serve(serverAnswer());
    queueScope('Workspace');
    queuePicks(() => true);
    await manageDefines();
    const title = fakeVscode.recorded.quickPicks[1].options?.title ?? '';
    expect(title).toContain('TMNEXT');
    expect(title).not.toContain('·');
  });

  it('degrades when the server refuses an uri it cannot scope', async () => {
    // Several plugin workspaces live and the active editor is in none of
    // them: the server rejects rather than hand back another plugin's set,
    // and the UI falls back to overrides-only.
    setResolvedDefinesProvider(async () => undefined);
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['DEV'] } });
    queueScope('Workspace');
    queuePicks(() => false);
    await manageDefines();
    expect(lastWrite()).toEqual(['-DEV']);
  });

  it('re-checking a target selector suppressed by a foreign one actually turns it on', async () => {
    // `defines: ["MP4"]` under game_target TMNEXT: the server REPLACES the
    // target's selectors, so TMNEXT is derived-on but currently OFF. The
    // minimal write (drop TMNEXT's override — there is none) would leave the
    // array untouched: the user checks the row, one settings write happens,
    // and nothing changes.
    serve(
      serverAnswer({
        defines: [
          { name: 'TMNEXT', active: false, origin: 'target', derivedActive: true },
          { name: 'MP4', active: true, origin: 'user', derivedActive: false },
        ],
      }),
    );
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['MP4'] } });
    queueScope('Workspace');
    queuePicks(() => true); // check TMNEXT; MP4 was already checked
    await manageDefines();
    const written = lastWrite() as string[];
    expect(written).toContain('TMNEXT');
    // MP4's row is still checked, so its entry stays: this UI does not delete
    // an entry the user did not uncheck.
    expect(written).toContain('MP4');
  });

  it('scopes the request to the active editor', async () => {
    const calls = serve();
    fakeVscode.__setActiveEditor('/ws/my-plugin/src/Main.as');
    queueScope('Workspace');
    queuePicks(() => true);
    await manageDefines();
    // Multi-root windows serve one config PER root; a window-wide answer
    // would be right for at most one of them.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/ws/my-plugin/src/Main.as');
  });

  it('uses the server target for the foreign-selector guard, not the setting', async () => {
    // The B034 caveat: the setting can disagree with a workspace
    // `.openplanet-lsp.toml`, and the server knows which one won.
    fakeVscode.__setConfig({ 'openplanetLsp.gameTarget': 'TMNEXT' });
    serve(
      serverAnswer({
        gameTarget: 'MP4',
        defines: [
          { name: 'MP4', active: true, origin: 'target', derivedActive: true },
          { name: 'MP41', active: true, origin: 'target', derivedActive: true },
          { name: 'TURBO', active: true, origin: 'user', derivedActive: false },
        ],
      }),
    );
    queueScope('Workspace');
    queuePicks(() => true);
    await manageDefines();
    const rows = fakeVscode.recorded.quickPicks[1].items as PickItem[];
    const detailOf = (n: string) => rows.find((r) => r.label === n)?.detail ?? '';
    // Same family as the SERVER's target: not foreign.
    expect(detailOf('MP41')).not.toContain('⚠');
    // Another generation: foreign, and the warning names the server's target.
    expect(detailOf('TURBO')).toContain('⚠');
    expect(detailOf('TURBO')).toContain('MP4');
  });

  it('says so when no server can answer, instead of showing a silent partial list', async () => {
    setResolvedDefinesProvider(undefined);
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['DEV'] } });
    queueScope('Workspace');
    queuePicks(() => true);
    await manageDefines();
    // The B034 complaint was a partial truth with no indication it was
    // partial. Degrading is fine; degrading silently is not.
    const placeholder = fakeVscode.recorded.quickPicks[1].options?.placeHolder ?? '';
    // Accurate for BOTH degraded cases: no server at all, and a server older
    // than B050 that answers MethodNotFound. `BINARY_REF` still pins v0.5.0,
    // so the second is the case users hit first.
    expect(placeholder).toContain('Overrides only');
    expect(placeholder).toContain('older build');
  });

  it('survives a provider that rejects', async () => {
    setResolvedDefinesProvider(() => Promise.reject(new Error('boom')));
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['DEV'] } });
    queueScope('Workspace');
    queuePicks(() => false);
    await manageDefines();
    expect(lastWrite()).toEqual(['-DEV']);
  });
});

/**
 * B050 gate: a derived row is a STATE the user can flip, never an ENTRY they
 * can delete. Nothing in the defines UI may remove a define the server
 * derived — the array does not contain it, so "removing" it could only mean
 * silently doing nothing while the row disappears.
 */
describe('derived rows are not deletable', () => {
  const DERIVED: ResolvedDefinesResult = {
    gameTarget: 'TMNEXT',
    platformFamilies: [['TMNEXT']],
    defines: [
      { name: 'TMNEXT', active: true, origin: 'target', derivedActive: true },
      { name: 'LOGS', active: true, origin: 'build', derivedActive: true },
      { name: 'MY_FLAG', active: true, origin: 'user', derivedActive: false },
    ],
  };

  beforeEach(() => setResolvedDefinesProvider(async () => DERIVED));
  afterEach(() => setResolvedDefinesProvider(undefined));

  it('Remove Define offers only the user’s own array entries', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['MY_FLAG'] } });
    queueScope('Workspace');
    queuePicks(() => false);
    await removeDefine();
    // TMNEXT and LOGS are derived and have no entry, so there is nothing to
    // delete and they must not be offered.
    expect(pickLabels(1)).toEqual(['MY_FLAG']);
  });

  it('Remove Define reports nothing to remove when every row is derived', async () => {
    queueScope('Workspace');
    await removeDefine();
    expect(fakeVscode.recorded.quickPicks).toHaveLength(1); // scope only
    expect(fakeVscode.recorded.infos.at(-1)).toContain('No define overrides');
    expect(updates()).toHaveLength(0);
  });

  it('unchecking a derived row ADDS a -NAME override; it deletes nothing', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['KEEP_ME'] } });
    queueScope('Workspace');
    queuePicks((i) => i.label !== 'LOGS');
    await manageDefines();
    const written = lastWrite() as string[];
    expect(written).toContain('-LOGS');
    // Every pre-existing element survives: this is an append, not a rewrite.
    expect(written).toContain('KEEP_ME');
  });

  it('re-checking a derived row REMOVES the override rather than writing an explicit add', async () => {
    // The server sees the `-LOGS` the user already wrote, so it reports LOGS
    // OFF but derived-ON — the present-but-disabled state.
    setResolvedDefinesProvider(async () => ({
      ...DERIVED,
      defines: DERIVED.defines.map((d) =>
        d.name === 'LOGS' ? { ...d, active: false, derivedActive: true } : d,
      ),
    }));
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['-LOGS', 'KEEP_ME'] } });
    queueScope('Workspace');
    queuePicks(() => true);
    await manageDefines();
    // derivedActive === true, so back-on is the DERIVED state and the minimal
    // write is dropping the override — not adding a redundant `LOGS`.
    expect(lastWrite()).toEqual(['KEEP_ME']);
  });

  it('labels a purely derived row as derived rather than as a missing entry', async () => {
    queueScope('Workspace');
    queuePicks(() => true);
    await manageDefines();
    const rows = fakeVscode.recorded.quickPicks[1].items as PickItem[];
    expect(rows.find((r) => r.label === 'LOGS')?.detail).toContain('derived by the server');
  });

  it('Clear Overrides only empties the user array; derived defines are untouched', async () => {
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['-LOGS', 'MY_FLAG'] } });
    queueScope('Workspace');
    queueButton('Clear');
    await clearDefineOverrides();
    // `unset` removes the KEY. It cannot express "delete a derived define",
    // which is exactly the property being pinned.
    expect(lastWrite()).toBeUndefined();
  });
});

describe('addDefine with server introspection', () => {
  afterEach(() => setResolvedDefinesProvider(undefined));

  it('writes nothing when the define is already derived-on, and says why', async () => {
    setResolvedDefinesProvider(async () => ({
      gameTarget: 'TMNEXT',
      platformFamilies: [['TMNEXT']],
      defines: [{ name: 'LOGS', active: true, origin: 'build', derivedActive: true }],
    }));
    fakeVscode.__queueInputBox(() => 'LOGS');
    queueScope('Workspace');
    await addDefine();
    expect(updates()).toHaveLength(0);
    expect(fakeVscode.recorded.infos.at(-1)).toContain('already on');
  });

  it('still writes an explicit entry for a define the server does not derive', async () => {
    setResolvedDefinesProvider(async () => ({
      gameTarget: 'TMNEXT',
      platformFamilies: [['TMNEXT']],
      defines: [{ name: 'LOGS', active: true, origin: 'build', derivedActive: true }],
    }));
    fakeVscode.__queueInputBox(() => 'MY_FLAG');
    queueScope('Workspace');
    await addDefine();
    expect(lastWrite()).toEqual(['MY_FLAG']);
  });

  it('turns a derived define off with a minimal -NAME entry', async () => {
    setResolvedDefinesProvider(async () => ({
      gameTarget: 'TMNEXT',
      platformFamilies: [['TMNEXT']],
      defines: [{ name: 'LOGS', active: true, origin: 'build', derivedActive: true }],
    }));
    fakeVscode.__queueInputBox(() => '-LOGS');
    queueScope('Workspace');
    await addDefine();
    expect(lastWrite()).toEqual(['-LOGS']);
  });
});

/**
 * B050 regressions the review loop surfaced, pinned so the simpler design
 * that avoids them stays that way. Both are cases where a fix that DELETES
 * entries needs extra special-casing; not deleting needs none.
 */
describe('addDefine near a foreign platform selector', () => {
  const FAMILIES = [['TMNEXT'], ['MP4', 'MP40', 'MP41'], ['TURBO']];
  afterEach(() => setResolvedDefinesProvider(undefined));

  function serveSelectors(defines: { name: string; active: boolean; derivedActive: boolean }[]) {
    setResolvedDefinesProvider(async () => ({
      gameTarget: 'TMNEXT',
      platformFamilies: FAMILIES,
      defines: defines.map((d) => ({ ...d, origin: 'target' as const })),
    }));
  }

  it('leaves an already-effective target and its foreign neighbour alone', async () => {
    // `["MP4","TMNEXT"]` is a legitimate array: the explicit TMNEXT survives
    // the replacement, so BOTH are live. Re-adding TMNEXT must not delete
    // either entry.
    serveSelectors([
      { name: 'TMNEXT', active: true, derivedActive: true },
      { name: 'MP4', active: true, derivedActive: false },
    ]);
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['MP4', 'TMNEXT'] } });
    fakeVscode.__queueInputBox(() => 'TMNEXT');
    queueScope('Workspace');
    await addDefine();
    expect(updates()).toHaveLength(0);
  });

  it('drops a local -NAME even when the server answer predates it', async () => {
    // The server answers from before the restart, so it still reports TMNEXT
    // on. The `-TMNEXT` the user just wrote is newer and must be removed, not
    // treated as "already on".
    serveSelectors([{ name: 'TMNEXT', active: true, derivedActive: true }]);
    fakeVscode.__setConfigScopes({ [KEY]: { workspaceValue: ['-TMNEXT', 'KEEP'] } });
    fakeVscode.__queueInputBox(() => 'TMNEXT');
    queueScope('Workspace');
    await addDefine();
    expect(lastWrite()).toEqual(['KEEP']);
  });
});
