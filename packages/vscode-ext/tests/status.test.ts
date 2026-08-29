import { describe, expect, it } from 'vitest';
import {
  ERROR_BACKGROUND,
  UNKNOWN,
  isFailureState,
  renderStatusBar,
  type ServerState,
  type StatusInfo,
} from '../src/status';

const ALL_STATES: ServerState[] = ['starting', 'ready', 'restarting', 'failed'];

const base: StatusInfo = {
  state: 'ready',
  serverPath: '~/.local/bin/openplanet-lsp',
  serverVersion: '0.5.0',
  typeDb: { core: '1.29.5', game: '1.29.5', source: '~/OpenplanetNext' },
  gameTarget: 'TMNEXT',
  workspaceRoot: '~/src/my-plugin',
};

describe('renderStatusBar', () => {
  it('renders a distinct text for every state', () => {
    const texts = ALL_STATES.map((state) => renderStatusBar({ ...base, state }).text);
    expect(new Set(texts).size).toBe(ALL_STATES.length);
  });

  it('renders a distinct tooltip summary for every state', () => {
    // Two states sharing a spinner icon must still be distinguishable to a
    // user who hovers, and to a screenshot in a bug report.
    const firstLines = ALL_STATES.map(
      (state) => renderStatusBar({ ...base, state }).tooltip.split('\n')[0],
    );
    expect(new Set(firstLines).size).toBe(ALL_STATES.length);
  });

  it('colours ONLY the failed state with the error background', () => {
    for (const state of ALL_STATES) {
      const render = renderStatusBar({ ...base, state });
      if (state === 'failed') {
        expect(render.backgroundColorId).toBe(ERROR_BACKGROUND);
      } else {
        expect(render.backgroundColorId).toBeUndefined();
      }
    }
  });

  it('marks starting and restarting as busy but not failed', () => {
    expect(isFailureState('starting')).toBe(false);
    expect(isFailureState('restarting')).toBe(false);
    expect(isFailureState('failed')).toBe(true);
  });

  it('puts every diagnostic field in the tooltip', () => {
    const tooltip = renderStatusBar(base).tooltip;
    expect(tooltip).toContain('~/.local/bin/openplanet-lsp');
    expect(tooltip).toContain('0.5.0');
    expect(tooltip).toContain('1.29.5');
    expect(tooltip).toContain('~/OpenplanetNext');
    expect(tooltip).toContain('TMNEXT');
    expect(tooltip).toContain('~/src/my-plugin');
  });

  it('names the failure reason in the tooltip', () => {
    const tooltip = renderStatusBar({
      ...base,
      state: 'failed',
      failureReason: 'spawn openplanet-lsp ENOENT',
    }).tooltip;
    expect(tooltip).toContain('spawn openplanet-lsp ENOENT');
  });

  it('omits the reason line when there is nothing to say', () => {
    expect(renderStatusBar({ ...base, state: 'failed' }).tooltip).not.toContain('Reason:');
  });

  it('says "unknown" rather than leaving a field blank', () => {
    // A blank line reads as "there is no type DB"; unknown reads as "the
    // extension could not find out", which is the truth before the probe
    // lands and after it fails.
    const tooltip = renderStatusBar({ state: 'starting' }).tooltip;
    const fields = tooltip
      .split('\n')
      .filter((l) => l.includes(':') && !l.startsWith('Openplanet'));
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      expect(f.trim().endsWith(':')).toBe(false);
    }
    expect(tooltip).toContain(UNKNOWN);
  });

  it('renders a partial type DB without inventing the missing half', () => {
    const tooltip = renderStatusBar({ ...base, typeDb: { core: '1.29.5' } }).tooltip;
    expect(tooltip).toContain('core 1.29.5');
    expect(tooltip).not.toContain('game 1.29.5');
  });

  it('tells the user the item is clickable', () => {
    expect(renderStatusBar(base).tooltip.toLowerCase()).toContain('click');
  });

  it('provides an aria label naming the state', () => {
    for (const state of ALL_STATES) {
      expect(renderStatusBar({ ...base, state }).ariaLabel).toMatch(/Openplanet LSP: \w/);
    }
  });
});
