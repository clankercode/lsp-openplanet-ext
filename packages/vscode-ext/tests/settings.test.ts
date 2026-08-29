import { describe, it, expect } from 'vitest';
import {
  buildInitializationOptions,
  isValidGameTarget,
  isValidSignatureMode,
  isValidUnusedLevel,
  GAME_TARGETS,
  SIGNATURE_MODES,
  UNUSED_LEVELS,
} from '../src/settings.js';

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

  it('omits pluginRoots when unset', () => {
    const opts = buildInitializationOptions({});
    expect(opts).toEqual({});
    expect('plugin_roots' in opts).toBe(false);
  });

  it('omits pluginRoots when empty (server auto-discovers)', () => {
    const opts = buildInitializationOptions({ pluginRoots: [] });
    expect(opts).toEqual({});
    expect('plugin_roots' in opts).toBe(false);
  });

  it('forwards non-empty pluginRoots verbatim as plugin_roots', () => {
    const pluginRoots = ['/home/u/plugins/my-plugin', '../sibling/other-plugin'];
    const opts = buildInitializationOptions({ pluginRoots });
    expect(opts).toEqual({ plugin_roots: pluginRoots });
  });

  it('omits pluginRoots when all entries are empty strings', () => {
    const opts = buildInitializationOptions({ pluginRoots: ['', '   '] });
    expect(opts).toEqual({});
    expect('plugin_roots' in opts).toBe(false);
  });

  it('filters empty entries out of pluginRoots', () => {
    const opts = buildInitializationOptions({ pluginRoots: ['', '/home/u/plugins/p', '  '] });
    expect(opts).toEqual({ plugin_roots: ['/home/u/plugins/p'] });
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

describe('signatureMode (GH #64)', () => {
  it('forwards a non-default level as signature_mode', () => {
    expect(buildInitializationOptions({ signatureMode: 'regular' })).toEqual({
      signature_mode: 'regular',
    });
  });

  it('omits the server default so a repo .openplanet-lsp.toml keeps control', () => {
    expect(buildInitializationOptions({ signatureMode: 'developer' })).toEqual({});
    expect(buildInitializationOptions({ signatureMode: '' })).toEqual({});
  });

  it('omits an unknown level rather than sending it', () => {
    expect(buildInitializationOptions({ signatureMode: 'banana' })).toEqual({});
  });

  it('accepts every documented level', () => {
    for (const mode of SIGNATURE_MODES) {
      expect(isValidSignatureMode(mode)).toBe(true);
    }
    expect(isValidSignatureMode('banana')).toBe(false);
    expect(SIGNATURE_MODES).toEqual(['developer', 'school', 'regular', 'official']);
  });

  it('rides alongside the other keys', () => {
    expect(
      buildInitializationOptions({
        gameTarget: 'MP4',
        signatureMode: 'official',
        defines: ['DEV'],
      }),
    ).toEqual({ game_target: 'MP4', signature_mode: 'official', defines: ['DEV'] });
  });
});

describe('unused level (server B030)', () => {
  it('forwards each documented level verbatim', () => {
    for (const level of UNUSED_LEVELS) {
      expect(buildInitializationOptions({ unused: level })).toEqual({ unused: level });
    }
  });

  it('omits an unset / empty / whitespace value so the repo config keeps control', () => {
    // Unlike gameTarget there is no "default" sentinel to skip: the setting's
    // own default is '', which means "do not send anything". Forwarding
    // 'warn' when the user never chose it would override a
    // .openplanet-lsp.toml that pins unused = "ignore".
    expect(buildInitializationOptions({})).toEqual({});
    expect(buildInitializationOptions({ unused: '' })).toEqual({});
    expect(buildInitializationOptions({ unused: '   ' })).toEqual({});
  });

  it('forwards warn when the user picks it explicitly', () => {
    expect(buildInitializationOptions({ unused: 'warn' })).toEqual({ unused: 'warn' });
  });

  it('omits an unknown level rather than sending garbage', () => {
    for (const bad of ['banana', 'HINT', 'grey', 'true']) {
      expect(buildInitializationOptions({ unused: bad })).toEqual({});
    }
  });

  it('validates the canonical set only', () => {
    for (const level of UNUSED_LEVELS) expect(isValidUnusedLevel(level)).toBe(true);
    expect(isValidUnusedLevel('banana')).toBe(false);
    expect(isValidUnusedLevel('')).toBe(false);
    expect(UNUSED_LEVELS).toEqual(['ignore', 'hint', 'info', 'warn', 'error']);
  });

  it('rides alongside the other keys', () => {
    expect(
      buildInitializationOptions({
        gameTarget: 'MP4',
        unused: 'hint',
        defines: ['DEV'],
      }),
    ).toEqual({ game_target: 'MP4', unused: 'hint', defines: ['DEV'] });
  });
});
