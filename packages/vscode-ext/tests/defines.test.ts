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
  platformSelectorCaution,
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

  it('matches Rust trimming for NEL, including after a negation prefix', () => {
    expect(parseDefineEntry('\u0085')).toBeUndefined();
    expect(parseDefineEntry('\u0085NAME\u0085')).toEqual({
      raw: '\u0085NAME\u0085',
      name: 'NAME',
      on: true,
    });
    expect(parseDefineEntry('-\u0085NAME')).toEqual({
      raw: '-\u0085NAME',
      name: 'NAME',
      on: false,
    });
  });

  it('preserves byte-order marks because Rust does not trim them', () => {
    expect(parseDefineEntry('\uFEFF')).toEqual({ raw: '\uFEFF', name: '\uFEFF', on: true });
    expect(parseDefineEntry('\uFEFFNAME\uFEFF')).toEqual({
      raw: '\uFEFFNAME\uFEFF',
      name: '\uFEFFNAME\uFEFF',
      on: true,
    });
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

/**
 * B050: the one case where "no override" does not mean "derived state".
 *
 * A plain foreign selector makes the server replace the target's selectors
 * (GH #36), so a target-family define can be derived-on and still OFF because
 * another entry suppresses it. The minimal write would then be a silent
 * no-op: the user checks the row, a settings write happens, nothing changes.
 */
describe('applyDefineEdit with a suppressing foreign selector', () => {
  const FAMILIES: readonly (readonly string[])[] = [['TMNEXT'], ['MP4', 'MP40', 'MP41'], ['TURBO']];

  it('writes the explicit entry instead of a no-op minimal write', () => {
    // Without this, the result is `['MP4']` again and TMNEXT stays off.
    expect(
      applyDefineEdit(['MP4'], {
        name: 'TMNEXT',
        on: true,
        derivedOn: true,
        gameTarget: 'TMNEXT',
        platformFamilies: FAMILIES,
      }),
    ).toEqual(['MP4', 'TMNEXT']);
  });

  it('never deletes the other define’s entry', () => {
    // The foreign row is still CHECKED in the QuickPick — the user did not
    // ask for it to go — and this module preserves entries for other defines
    // verbatim. Both end up on, which is exactly what the picker showed.
    const out = applyDefineEdit(['KEEP', 'MP4', '-LOGS'], {
      name: 'TMNEXT',
      on: true,
      derivedOn: true,
      gameTarget: 'TMNEXT',
      platformFamilies: FAMILIES,
    });
    expect(out).toContain('MP4');
    expect(out).toContain('KEEP');
    expect(out).toContain('-LOGS');
    expect(out).toContain('TMNEXT');
  });

  it('still writes minimally when the foreign selector is NEGATED', () => {
    // `-MP4` is a removal; the server builds its `foreign` list from the ADDS
    // bucket only, so nothing is suppressed and the shortcut is safe.
    expect(
      applyDefineEdit(['-MP4', '-TMNEXT'], {
        name: 'TMNEXT',
        on: true,
        derivedOn: true,
        gameTarget: 'TMNEXT',
        platformFamilies: FAMILIES,
      }),
    ).toEqual(['-MP4']);
  });

  it('still writes minimally for a SAME-family selector', () => {
    // `MP40` under `MP4` is not foreign, so it triggers no replacement.
    expect(
      applyDefineEdit(['MP40', '-MP41'], {
        name: 'MP41',
        on: true,
        derivedOn: true,
        gameTarget: 'MP4',
        platformFamilies: FAMILIES,
      }),
    ).toEqual(['MP40']);
  });

  it('still writes minimally for a non-selector define', () => {
    // A foreign selector suppresses selectors, not `LOGS`.
    expect(
      applyDefineEdit(['MP4', '-LOGS'], {
        name: 'LOGS',
        on: true,
        derivedOn: true,
        gameTarget: 'TMNEXT',
        platformFamilies: FAMILIES,
      }),
    ).toEqual(['MP4']);
  });

  it('is inert when turning a selector OFF', () => {
    // Only re-enabling can hit the no-op; a disable always writes `-NAME`.
    expect(
      applyDefineEdit(['MP4'], {
        name: 'TMNEXT',
        on: false,
        derivedOn: true,
        gameTarget: 'TMNEXT',
        platformFamilies: FAMILIES,
      }),
    ).toEqual(['MP4', '-TMNEXT']);
  });

  it('is inert offline, where no minimal write is attempted anyway', () => {
    expect(applyDefineEdit(['MP4'], { name: 'TMNEXT', on: true })).toEqual(['MP4', 'TMNEXT']);
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

describe('platformSelectorCaution', () => {
  it('warns about a selector from another game generation', () => {
    // GH #36 / B024: `apply_define_overrides` treats a platform selector that
    // is foreign to `game_target` as authoritative and REMOVES every selector
    // the user did not list — including the target's own.
    const caution = platformSelectorCaution('MP4', 'TMNEXT');
    expect(caution).toBeDefined();
    expect(caution).toContain('MP4');
    expect(caution).toContain('TMNEXT');
  });

  it.each([
    ['MP40', 'MP4'],
    ['MP4', 'MP41'],
    ['MP41', 'MP40'],
    ['MP4', 'MP4'],
    ['UNITED', 'UNITED_FOREVER'],
    ['UNITED_FOREVER', 'UNITED'],
    ['TMNEXT', 'TMNEXT'],
  ])('stays silent for %s within the %s family', (name, gameTarget) => {
    // Same family is NOT foreign server-side, so warning here would be a false
    // alarm on a perfectly ordinary edit.
    expect(platformSelectorCaution(name, gameTarget)).toBeUndefined();
  });

  it.each(['DEV', 'LOGS', 'DEPENDENCY_DIPS', 'SIG_DEVELOPER', 'MY_FLAG'])(
    'stays silent for %s, which is not a platform selector at all',
    (name) => {
      expect(platformSelectorCaution(name, 'TMNEXT')).toBeUndefined();
    },
  );

  it('stays silent when the game target is unknown to the extension', () => {
    // Nothing to compare against; a guess would be worse than silence.
    expect(platformSelectorCaution('MP4', undefined)).toBeUndefined();
    expect(platformSelectorCaution('MP4', '')).toBeUndefined();
  });

  it('warns for any selector when the configured target is not a known one', () => {
    // The server does `platform_family_for_target(...).unwrap_or(&[])`, so with
    // an unrecognised target EVERY listed selector is foreign.
    expect(platformSelectorCaution('MP4', 'NOT_A_GAME')).toBeDefined();
  });
});

describe('validateDefineEntry with a game target', () => {
  it('warns, without blocking, about adding a foreign platform selector', () => {
    const issue = validateDefineEntry('MP4', 'TMNEXT');
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toContain('TMNEXT');
  });

  it.each(['-MP4', '!MP4'])('does not warn about %s, which REMOVES a selector', (raw) => {
    // The server builds `foreign` from the ADDS bucket only, so a removal
    // never triggers the replacement. Warning here would be plain wrong.
    expect(validateDefineEntry(raw, 'TMNEXT')).toBeUndefined();
  });

  it('does not warn about a same-family selector', () => {
    expect(validateDefineEntry('MP40', 'MP4')).toBeUndefined();
  });

  it('does not warn about an ordinary define', () => {
    expect(validateDefineEntry('MY_FLAG', 'TMNEXT')).toBeUndefined();
  });

  it('still reports the identifier problem first', () => {
    const issue = validateDefineEntry('MY DEFINE', 'TMNEXT');
    expect(issue?.message).toContain('MY_DEFINE');
  });

  it('behaves exactly as before when no game target is supplied', () => {
    expect(validateDefineEntry('MP4')).toBeUndefined();
  });
});

/**
 * B050: the foreign-selector guard asks the server when it can.
 *
 * B034 shipped a duplicated family table because nothing exposed the server's.
 * Now that `openplanet/resolvedDefines` carries it, the copy is the OFFLINE
 * fallback and the server's answer wins — including when the two disagree,
 * which is the only case where the distinction is observable.
 */
describe('platformSelectorCaution with a server family table', () => {
  const SERVER: readonly (readonly string[])[] = [['TMNEXT'], ['MP4', 'MP40', 'MP41', 'MP42']];

  it('treats a selector as same-family per the SERVER table', () => {
    expect(platformSelectorCaution('MP42', 'MP4', SERVER)).toBeUndefined();
  });

  it('catches a hazard the stale bundled copy would MISS', () => {
    // This is the drift that matters, and it fails silently in the direction
    // that hurts: `MP42` is a selector the bundled table has never heard of,
    // so offline the guard says nothing — while the server would replace
    // TMNEXT's selectors and kill every `#if TMNEXT` branch (GH #36).
    expect(platformSelectorCaution('MP42', 'TMNEXT', SERVER)).toContain('MP42');
    expect(platformSelectorCaution('MP42', 'TMNEXT')).toBeUndefined();
  });

  it('still warns for a genuinely foreign selector', () => {
    const caution = platformSelectorCaution('TMNEXT', 'MP4', SERVER);
    expect(caution).toContain('TMNEXT');
    expect(caution).toContain('MP4');
  });

  it('is silent for a name the server table does not know at all', () => {
    // Not a selector per the server, so not the GH #36 hazard.
    expect(platformSelectorCaution('TURBO', 'MP4', SERVER)).toBeUndefined();
  });

  it('falls back to the bundled table when the server sent none', () => {
    for (const families of [undefined, []]) {
      expect(platformSelectorCaution('MP4', 'TMNEXT', families)).toContain('MP4');
      expect(platformSelectorCaution('MP41', 'MP4', families)).toBeUndefined();
    }
  });

  it('validateDefineEntry forwards the families to the guard', () => {
    // The InputBox validator is synchronous, so it can only use a table that
    // has already arrived — but when one has, it must be the one used.
    expect(validateDefineEntry('MP42', 'MP4', SERVER)).toBeUndefined();
    expect(validateDefineEntry('MP42', 'TMNEXT', SERVER)?.severity).toBe('warning');
    // Offline the same entry is accepted without comment — a valid
    // identifier the bundled table cannot recognise as a selector.
    expect(validateDefineEntry('MP42', 'TMNEXT')).toBeUndefined();
    // A removal never trips the replacement, with or without a table.
    expect(validateDefineEntry('-TMNEXT', 'MP4', SERVER)).toBeUndefined();
  });
});
