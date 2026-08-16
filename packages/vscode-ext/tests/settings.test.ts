import { describe, it, expect } from 'vitest';
import { buildInitializationOptions, isValidGameTarget, GAME_TARGETS } from '../src/settings.js';

describe('buildInitializationOptions', () => {
  it('returns an empty object when nothing is set', () => {
    expect(buildInitializationOptions({})).toEqual({});
  });

  it('returns an empty object when values are empty strings', () => {
    expect(
      buildInitializationOptions({
        openplanetDir: '',
        pluginsDir: '',
        gameTarget: '',
        defines: [],
      }),
    ).toEqual({});
  });

  it('omits whitespace-only values', () => {
    expect(buildInitializationOptions({ openplanetDir: '   ' })).toEqual({});
  });

  it('maps camelCase settings to snake_case init keys', () => {
    const opts = buildInitializationOptions({
      openplanetDir: '/home/u/OpenPlanetNext',
      pluginsDir: '/home/u/OpenPlanetNext/Plugins',
      gameTarget: 'TURBO',
      defines: ['DEV', 'MY_FLAG'],
    });
    expect(opts).toEqual({
      openplanet_dir: '/home/u/OpenPlanetNext',
      plugins_dir: '/home/u/OpenPlanetNext/Plugins',
      game_target: 'TURBO',
      defines: ['DEV', 'MY_FLAG'],
    });
  });

  it('omits gameTarget TMNEXT (server default) so repo config can differ', () => {
    // Precedence: forwarding 'TMNEXT' would override a .openplanet-lsp.toml
    // that sets e.g. game_target = "MP4". The default must stay unsent.
    const opts = buildInitializationOptions({ gameTarget: 'TMNEXT' });
    expect(opts).toEqual({});
  });

  it('omits invalid gameTarget values rather than sending garbage', () => {
    expect(buildInitializationOptions({ gameTarget: 'not-a-game' })).toEqual({});
  });

  it('forwards every valid game target except the default', () => {
    for (const t of GAME_TARGETS) {
      const opts = buildInitializationOptions({ gameTarget: t });
      if (t === 'TMNEXT') {
        expect(opts).toEqual({});
      } else {
        expect(opts).toEqual({ game_target: t });
      }
    }
  });

  it('never sends serverPath (extension-local only)', () => {
    const opts = buildInitializationOptions({ serverPath: '/usr/local/bin/openplanet-lsp' });
    expect(opts).toEqual({});
    expect('serverPath' in opts).toBe(false);
    expect('server_path' in opts).toBe(false);
  });
});

describe('isValidGameTarget', () => {
  it('accepts the server-defined targets', () => {
    for (const t of GAME_TARGETS) expect(isValidGameTarget(t)).toBe(true);
  });
  it('rejects unknown strings', () => {
    for (const t of ['tmnext', 'MP5', '', 'TMNEXT ']) expect(isValidGameTarget(t)).toBe(false);
  });
});
