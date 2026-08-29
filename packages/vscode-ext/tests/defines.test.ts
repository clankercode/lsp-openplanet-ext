import { describe, expect, it } from 'vitest';

import {
  applyDefineEdit,
  applyDefineEdits,
  baseEntriesForScope,
  buildDefineRows,
  describeOrigin,
  formatDefineEntry,
  overrideStates,
  parseDefineEntries,
  parseDefineEntry,
  planClearOverrides,
  removeDefineEntries,
  validateDefineEntry,
  type ResolvedDefine,
} from '../src/defines';

/**
 * Pure-logic tests for the defines edit list (B034).
 *
 * The contract being pinned here is the SERVER's, from
 * `LspConfig::apply_define_overrides` (src/config.rs, B024):
 *
 *   - each entry is trimmed;
 *   - a single leading `-` or `!` means REMOVE, the rest is trimmed again;
 *   - an entry that is empty after that is dropped;
 *   - adds are applied first and removes second, so a REMOVE WINS over an add
 *     of the same name no matter where the two sit in the array;
 *   - names are compared byte-for-byte (a `HashSet<String>`), so `dev` and
 *     `DEV` are two different defines.
 *
 * Anything here that diverges from that is a bug in the extension, not a
 * preference.
 */

describe('parseDefineEntry', () => {
  it.each([
    ['LOGS', { raw: 'LOGS', name: 'LOGS', on: true }],
    ['  LOGS  ', { raw: '  LOGS  ', name: 'LOGS', on: true }],
    ['-LOGS', { raw: '-LOGS', name: 'LOGS', on: false }],
    ['!LOGS', { raw: '!LOGS', name: 'LOGS', on: false }],
    ['- LOGS', { raw: '- LOGS', name: 'LOGS', on: false }],
    ['  ! LOGS ', { raw: '  ! LOGS ', name: 'LOGS', on: false }],
  ])('parses %j', (raw, want) => {
    expect(parseDefineEntry(raw)).toEqual(want);
  });

  it.each(['', '   ', '-', '!', ' - ', '!  '])('drops the meaningless entry %j', (raw) => {
    // The server drops these too (`if !name.is_empty()`), so the UI must
    // never present them as a define the user can toggle.
    expect(parseDefineEntry(raw)).toBeUndefined();
  });

  it('strips only ONE negation prefix, matching strip_prefix', () => {
    // `--LOGS` removes a define literally named `-LOGS`. Odd, but it is what
    // the server does, and inventing a double-negative here would make the UI
    // disagree with the array it is editing.
    expect(parseDefineEntry('--LOGS')).toEqual({ raw: '--LOGS', name: '-LOGS', on: false });
  });

  it('is case sensitive: dev and DEV are different defines', () => {
    expect(parseDefineEntry('dev')?.name).toBe('dev');
    expect(parseDefineEntry('DEV')?.name).toBe('DEV');
  });
});

describe('parseDefineEntries', () => {
  it('keeps array order and skips unparseable entries', () => {
    expect(parseDefineEntries(['A', '', '-B', '  ', 'C']).map((e) => e.name)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });
});

describe('overrideStates', () => {
  it('reports a plain entry as on and a prefixed entry as off', () => {
    const states = overrideStates(['DEV', '-LOGS']);
    expect(states.get('DEV')).toBe(true);
    expect(states.get('LOGS')).toBe(false);
  });

  it.each([
    [['DEV', '-DEV'], 'add before remove'],
    [['-DEV', 'DEV'], 'remove before add'],
    [['DEV', '!DEV'], 'bang form, add first'],
    [['!DEV', 'DEV'], 'bang form, remove first'],
  ])('resolves the contradictory array %j deterministically to OFF (%s)', (entries) => {
    // apply_define_overrides applies every add, THEN every remove — so the
    // remove wins regardless of order. The UI must show OFF, not "last wins".
    expect(overrideStates(entries).get('DEV')).toBe(false);
  });

  it('collapses duplicates instead of accumulating them', () => {
    const states = overrideStates(['DEV', 'DEV', 'DEV']);
    expect(states.size).toBe(1);
    expect(states.get('DEV')).toBe(true);
  });

  it('treats dev and DEV as separate defines', () => {
    const states = overrideStates(['dev', '-DEV']);
    expect(states.get('dev')).toBe(true);
    expect(states.get('DEV')).toBe(false);
  });
});

describe('applyDefineEdit', () => {
  it('toggle_off_adds_minus_entry', () => {
    expect(applyDefineEdit([], { name: 'TMNEXT', on: false, derivedOn: true })).toEqual([
      '-TMNEXT',
    ]);
  });

  it('toggle_back_on_removes_override', () => {
    // The array must return to its ORIGINAL contents — no redundant bare
    // `TMNEXT` left behind restating what the target already derives.
    const original = ['DEV', 'OTHER'];
    const off = applyDefineEdit(original, { name: 'TMNEXT', on: false, derivedOn: true });
    expect(off).toEqual(['DEV', 'OTHER', '-TMNEXT']);
    expect(applyDefineEdit(off, { name: 'TMNEXT', on: true, derivedOn: true })).toEqual(original);
  });

  it('toggle_on_for_derived_off_adds_bare_entry', () => {
    expect(applyDefineEdit([], { name: 'DEV', on: true, derivedOn: false })).toEqual(['DEV']);
  });

  it('toggle_off_for_derived_off_removes_the_override', () => {
    // The mirror image of toggle_back_on: a define the base set already lacks,
    // turned off, needs no entry at all.
    expect(applyDefineEdit(['DEV'], { name: 'DEV', on: false, derivedOn: false })).toEqual([]);
  });

  it.each([
    ['-LOGS', 'dash'],
    ['!LOGS', 'bang'],
  ])('round-trips identically through the %s negation form (%s)', (entry) => {
    // Both prefixes mean the same thing to the server, so both must return the
    // array to the same place — and the canonical write form is `-`.
    const start = ['KEEP', entry];
    const on = applyDefineEdit(start, { name: 'LOGS', on: true, derivedOn: true });
    expect(on).toEqual(['KEEP']);
    expect(applyDefineEdit(on, { name: 'LOGS', on: false, derivedOn: true })).toEqual([
      'KEEP',
      '-LOGS',
    ]);
  });

  it('replaces an existing entry in place rather than appending a second one', () => {
    expect(
      applyDefineEdit(['A', 'LOGS', 'B'], { name: 'LOGS', on: false, derivedOn: true }),
    ).toEqual(['A', '-LOGS', 'B']);
  });

  it('collapses duplicate and contradictory entries for the edited name', () => {
    expect(
      applyDefineEdit(['LOGS', '-LOGS', 'LOGS', 'KEEP'], {
        name: 'LOGS',
        on: true,
        derivedOn: false,
      }),
    ).toEqual(['LOGS', 'KEEP']);
  });

  it('writes an explicit entry when the derived state is unknown', () => {
    // Without server introspection the extension cannot know whether removing
    // the override would leave the define on or off, so it must state the
    // wanted state outright rather than guess.
    expect(applyDefineEdit([], { name: 'LOGS', on: false })).toEqual(['-LOGS']);
    expect(applyDefineEdit([], { name: 'LOGS', on: true })).toEqual(['LOGS']);
  });

  it('leaves entries for other defines untouched, including unparseable ones', () => {
    expect(
      applyDefineEdit(['', 'OTHER', '  '], { name: 'LOGS', on: false, derivedOn: true }),
    ).toEqual(['', 'OTHER', '  ', '-LOGS']);
  });

  it('does not confuse a name that is a prefix of another', () => {
    expect(applyDefineEdit(['LOGSX'], { name: 'LOGS', on: false, derivedOn: true })).toEqual([
      'LOGSX',
      '-LOGS',
    ]);
  });

  it('edits dev without touching DEV', () => {
    expect(applyDefineEdit(['DEV'], { name: 'dev', on: true, derivedOn: false })).toEqual([
      'DEV',
      'dev',
    ]);
  });
});

describe('applyDefineEdits', () => {
  it('applies a whole batch in one pass', () => {
    expect(
      applyDefineEdits(
        ['KEEP'],
        [
          { name: 'A', on: false, derivedOn: true },
          { name: 'B', on: true, derivedOn: false },
          { name: 'C', on: false, derivedOn: false },
        ],
      ),
    ).toEqual(['KEEP', '-A', 'B']);
  });

  it('is a no-op for an empty batch', () => {
    const entries = ['A', '-B'];
    expect(applyDefineEdits(entries, [])).toEqual(entries);
  });

  it('lets a later edit of the same name win', () => {
    expect(
      applyDefineEdits(
        [],
        [
          { name: 'A', on: true, derivedOn: false },
          { name: 'A', on: false, derivedOn: false },
        ],
      ),
    ).toEqual([]);
  });
});

describe('removeDefineEntries', () => {
  it('removes exactly the raw entries named', () => {
    expect(removeDefineEntries(['A', '-B', 'C'], ['-B'])).toEqual(['A', 'C']);
  });

  it('removes every copy of a duplicated raw entry', () => {
    expect(removeDefineEntries(['A', 'A', 'B'], ['A'])).toEqual(['B']);
  });

  it('is a no-op when nothing matches', () => {
    expect(removeDefineEntries(['A'], ['B'])).toEqual(['A']);
  });
});

describe('formatDefineEntry', () => {
  it('writes the canonical dash form for off', () => {
    expect(formatDefineEntry('LOGS', false)).toBe('-LOGS');
  });

  it('writes the bare name for on', () => {
    expect(formatDefineEntry('LOGS', true)).toBe('LOGS');
  });
});

describe('validateDefineEntry', () => {
  it.each([
    ['LOGS', 'plain identifier'],
    ['_PRIVATE', 'leading underscore'],
    ['DEPENDENCY_TM_CONTROL_MCP', 'dependency define'],
    ['dev', 'lowercase — case is preserved, not upcased'],
    ['-LOGS', 'the off form is a legal thing to type'],
    ['!LOGS', 'the bang off form'],
    ['A'.repeat(500), 'a very long but valid identifier'],
  ])('accepts %j without an issue (%s)', (raw) => {
    expect(validateDefineEntry(raw)).toBeUndefined();
  });

  it.each([
    ['', 'empty'],
    ['    ', 'whitespace only'],
    ['-', 'a bare negation prefix'],
    ['!  ', 'a bang with nothing after it'],
  ])('rejects %j as an error (%s)', (raw) => {
    // These are exactly the entries the server itself drops, so accepting them
    // would write a line into settings.json that provably does nothing.
    expect(validateDefineEntry(raw)?.severity).toBe('error');
  });

  it.each([
    ['1FOO', 'leading digit'],
    ['MY DEFINE', 'contains a space'],
    ['MY.DEFINE', 'contains a dot'],
    ['MY-DEFINE', 'contains a dash'],
    ['DIPS++', 'symbols'],
  ])('warns about %j without blocking it (%s)', (raw) => {
    // The server stores these verbatim (it deliberately does NOT sanitise —
    // see dependency_define_suffix), they are just inert: no `#if` can name
    // them. Refusing them would make the UI weaker than raw JSON; saying
    // nothing would let a typo look like it worked.
    expect(validateDefineEntry(raw)?.severity).toBe('warning');
  });

  it.each(['MY DEFINE', 'MY.DEFINE', 'MY-DEFINE'])(
    'suggests the Openplanet underscore mapping for %j',
    (raw) => {
      // Openplanet's own id -> macro rule replaces space, `-` and `.` with `_`
      // (docs, "Plugin Dependencies"), so that is the fix to point at.
      expect(validateDefineEntry(raw)?.message).toContain('MY_DEFINE');
    },
  );
});

describe('buildDefineRows', () => {
  it('lists the user overrides when the resolved set is unavailable', () => {
    // No server request exposes the resolved set yet, so origin is the only
    // one the extension can state truthfully: the user's own setting.
    const rows = buildDefineRows(['DEV', '-LOGS']);
    expect(rows).toEqual([
      { name: 'DEV', active: true, origin: 'user', entry: 'DEV' },
      { name: 'LOGS', active: false, origin: 'user', entry: '-LOGS' },
    ]);
  });

  it('shows the effective state for a contradictory override', () => {
    const rows = buildDefineRows(['DEV', '-DEV']);
    expect(rows).toEqual([{ name: 'DEV', active: false, origin: 'user', entry: '-DEV' }]);
  });

  it('merges overrides onto a resolved set, keeping the derived state', () => {
    const resolved: ResolvedDefine[] = [
      { name: 'TMNEXT', active: true, origin: 'target', derivedActive: true },
      { name: 'LOGS', active: false, origin: 'user', derivedActive: true },
    ];
    expect(buildDefineRows(['-LOGS'], resolved)).toEqual([
      { name: 'TMNEXT', active: true, origin: 'target', derivedOn: true, entry: undefined },
      { name: 'LOGS', active: false, origin: 'user', derivedOn: true, entry: '-LOGS' },
    ]);
  });

  it('appends an override the resolved set does not mention', () => {
    const resolved: ResolvedDefine[] = [
      { name: 'TMNEXT', active: true, origin: 'target', derivedActive: true },
    ];
    const rows = buildDefineRows(['MYFLAG'], resolved);
    expect(rows.map((r) => r.name)).toEqual(['TMNEXT', 'MYFLAG']);
    expect(rows[1]).toEqual({
      name: 'MYFLAG',
      active: true,
      origin: 'user',
      derivedOn: undefined,
      entry: 'MYFLAG',
    });
  });

  it('keeps an unresolved dependency listed and toggleable (B019)', () => {
    const resolved: ResolvedDefine[] = [
      {
        name: 'DEPENDENCY_DIPS',
        active: false,
        origin: 'dependency-missing',
        derivedActive: false,
      },
    ];
    const rows = buildDefineRows([], resolved);
    expect(rows[0].active).toBe(false);
    // Toggling it ON is the documented way to check the branch a user who has
    // the dependency would compile.
    expect(
      applyDefineEdit([], { name: rows[0].name, on: true, derivedOn: rows[0].derivedOn }),
    ).toEqual(['DEPENDENCY_DIPS']);
  });
});

describe('describeOrigin', () => {
  it.each([
    ['target', 'game target'],
    ['signature', 'signature level'],
    ['manifest', 'info.toml'],
    ['dependency', 'dependency'],
    ['dependency-missing', 'not installed'],
    ['user', 'user setting'],
  ] as const)('describes %s as text containing %j', (origin, fragment) => {
    expect(describeOrigin(origin)).toContain(fragment);
  });

  it('never returns an empty label for an unknown origin', () => {
    expect(describeOrigin('unknown').length).toBeGreaterThan(0);
  });
});

describe('baseEntriesForScope', () => {
  it('edits the workspace array when one exists', () => {
    expect(
      baseEntriesForScope({ globalValue: ['USER'], workspaceValue: ['WS'] }, 'workspace'),
    ).toEqual(['WS']);
  });

  it('seeds a new workspace array from the user value it is about to shadow', () => {
    // A VS Code array setting does NOT merge across scopes — a workspace value
    // REPLACES the user one. Starting from [] would silently drop every
    // override the user can currently see.
    expect(baseEntriesForScope({ globalValue: ['USER'] }, 'workspace')).toEqual(['USER']);
  });

  it('edits the user array without pulling in workspace entries', () => {
    // The reverse seeding would be wrong: the workspace value already shadows
    // the user one, so copying it up would add entries that change nothing now
    // and reappear the moment the workspace value goes away.
    expect(baseEntriesForScope({ globalValue: ['USER'], workspaceValue: ['WS'] }, 'user')).toEqual([
      'USER',
    ]);
  });

  it.each(['workspace', 'user'] as const)('starts empty for %s when nothing is set', (scope) => {
    expect(baseEntriesForScope({}, scope)).toEqual([]);
  });

  it('copies rather than aliases the stored array', () => {
    const inspected = { workspaceValue: ['WS'] };
    baseEntriesForScope(inspected, 'workspace').push('MUTATED');
    expect(inspected.workspaceValue).toEqual(['WS']);
  });
});

describe('planClearOverrides', () => {
  it('unsets the key when nothing would show through', () => {
    expect(planClearOverrides({ workspaceValue: ['WS'] }, 'workspace')).toEqual({
      action: 'unset',
    });
    expect(planClearOverrides({ globalValue: ['USER'] }, 'user')).toEqual({ action: 'unset' });
  });

  it('writes an explicit empty array when a user value would otherwise reappear', () => {
    expect(
      planClearOverrides({ globalValue: ['USER'], workspaceValue: ['WS'] }, 'workspace'),
    ).toEqual({ action: 'empty' });
  });

  it('shadows a user value even when the workspace has no array yet', () => {
    expect(planClearOverrides({ globalValue: ['USER'] }, 'workspace')).toEqual({ action: 'empty' });
  });

  it.each(['workspace', 'user'] as const)(
    'is a no-op for %s when there is nothing to clear',
    (scope) => {
      expect(planClearOverrides({}, scope)).toEqual({ action: 'noop' });
      expect(planClearOverrides({ globalValue: [], workspaceValue: [] }, scope)).toEqual({
        action: 'noop',
      });
    },
  );

  it('is a no-op when the scope array is already empty and nothing shows through', () => {
    expect(planClearOverrides({ workspaceValue: [], globalValue: [] }, 'workspace')).toEqual({
      action: 'noop',
    });
  });

  it('does not clear the user array from the workspace scope', () => {
    // Scope isolation: clearing at one scope must never touch the other.
    expect(planClearOverrides({ globalValue: ['USER'] }, 'user')).toEqual({ action: 'unset' });
    expect(planClearOverrides({ globalValue: ['USER'] }, 'workspace')).toEqual({
      action: 'empty',
    });
  });
});
