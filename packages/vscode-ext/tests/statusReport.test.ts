import { describe, expect, it } from 'vitest';
import { buildStatusReport, type StatusReportInput } from '../src/statusReport';

/**
 * `showStatus` is a bug-report aid: assume every line ends up in a public
 * GitHub issue. These tests pin the two properties that matter — it says
 * enough to diagnose from, and it does not leak the user's home directory or
 * their environment.
 */
const full: StatusReportInput = {
  state: 'ready',
  serverPath: '/home/max/.local/bin/openplanet-lsp',
  serverSource: 'PATH',
  serverVersion: '0.5.0',
  typeDb: { core: '1.29.5', game: '1.29.5', source: '/home/max/OpenplanetNext' },
  gameTarget: 'TMNEXT',
  signatureMode: 'developer',
  unused: 'warn',
  inactiveRegions: 'hint',
  defines: ['DEV', '-LOGS'],
  pluginRoots: ['/home/max/src/my-plugin'],
  workspaceFolders: ['/home/max/src/my-plugin', '/home/max/src/other'],
  activeWorkspaceRoot: '/home/max/src/my-plugin',
  extensionVersion: '0.3.0',
  vscodeVersion: '1.99.0',
  platform: 'linux',
  home: '/home/max',
};

describe('buildStatusReport', () => {
  it('reports the resolved server path, version and game target', () => {
    const out = buildStatusReport(full);
    expect(out).toContain('openplanet-lsp');
    expect(out).toContain('0.5.0');
    expect(out).toContain('TMNEXT');
    expect(out).toContain('1.29.5');
  });

  it('abbreviates EVERY home path to ~', () => {
    const out = buildStatusReport(full);
    expect(out).not.toContain('/home/max');
    expect(out).toContain('~/.local/bin/openplanet-lsp');
    expect(out).toContain('~/OpenplanetNext');
    expect(out).toContain('~/src/my-plugin');
    expect(out).toContain('~/src/other');
  });

  it('does not dump the environment', () => {
    // Guard against someone "helpfully" adding process.env to the report.
    const secret = 'OPENPLANET_LSP_TEST_SECRET_VALUE';
    process.env[secret] = 'leaked';
    try {
      const out = buildStatusReport(full);
      expect(out).not.toContain(secret);
      expect(out).not.toContain('leaked');
      expect(out.toUpperCase()).not.toContain('PATH=');
    } finally {
      delete process.env[secret];
    }
  });

  it('reports plugin roots, defines and all workspace folders', () => {
    const out = buildStatusReport(full);
    expect(out).toContain('DEV, -LOGS');
    expect(out).toContain('~/src/my-plugin, ~/src/other');
  });

  it('names the failure reason when the server failed', () => {
    const out = buildStatusReport({
      ...full,
      state: 'failed',
      failureReason: 'spawn openplanet-lsp ENOENT',
    });
    expect(out).toContain('failed');
    expect(out).toContain('spawn openplanet-lsp ENOENT');
  });

  it('redacts home paths embedded in every diagnostic string', () => {
    const out = buildStatusReport({
      ...full,
      failureReason:
        'spawn /physical/users/max/.local/bin/openplanet-lsp after reading /home/max/.config/openplanet',
      serverSource: 'configured at /home/max/.config/Code/settings.json',
      typeDb: { source: '/physical/users/max/OpenplanetNext' },
      homeAliases: ['/home/max/', '/physical/users/max'],
    });
    expect(out).not.toContain('/home/max');
    expect(out).not.toContain('/physical/users/max');
    expect(out).toContain('spawn ~/.local/bin/openplanet-lsp after reading ~/.config/openplanet');
    expect(out).toContain('configured at ~/.config/Code/settings.json');
    expect(out).toContain('Type DB source: ~/OpenplanetNext');
  });

  it('redacts Windows home paths embedded in a failure reason', () => {
    const out = buildStatusReport({
      state: 'failed',
      failureReason: 'spawn C:/USERS/max/bin/openplanet-lsp.exe failed',
      platform: 'win32',
      home: 'C:\\Users\\Max\\',
    });
    expect(out).not.toContain('USERS/max');
    expect(out).toContain('spawn ~/bin/openplanet-lsp.exe failed');
  });

  it('redacts standalone POSIX and Windows home paths before terminal prose punctuation', () => {
    const posix = buildStatusReport({
      ...full,
      state: 'failed',
      failureReason: 'failed to open /home/max. Retry after fixing permissions.',
    });
    expect(posix).not.toContain('/home/max');
    expect(posix).toContain('failed to open ~. Retry after fixing permissions.');

    const windows = buildStatusReport({
      state: 'failed',
      failureReason: 'failed to open (C:\\Users\\Max)',
      platform: 'win32',
      home: 'C:\\Users\\Max',
    });
    expect(windows).not.toContain('Users\\Max');
    expect(windows).toContain('failed to open (~)');
  });

  it('degrades to placeholders with nothing resolved and no workspace', () => {
    const out = buildStatusReport({ state: 'starting' });
    expect(out).toContain('unknown');
    expect(out).toContain('(none)');
    // No stray "undefined" leaking into text a user will paste.
    expect(out).not.toContain('undefined');
  });

  it('distinguishes an unset setting from an unknown fact', () => {
    const out = buildStatusReport({ state: 'ready', gameTarget: '' });
    expect(out).toContain('(unset)');
  });

  it('ends with a trailing newline', () => {
    expect(buildStatusReport(full).endsWith('\n')).toBe(true);
  });

  it('is markdown with a heading, so it renders when pasted', () => {
    expect(buildStatusReport(full).startsWith('# ')).toBe(true);
  });

  it('abbreviates windows home paths too', () => {
    const out = buildStatusReport({
      state: 'ready',
      serverPath: 'C:\\Users\\Max\\bin\\openplanet-lsp.exe',
      workspaceFolders: ['C:\\Users\\Max\\src\\plugin'],
      platform: 'win32',
      home: 'C:\\Users\\Max',
    });
    expect(out).not.toContain('Users\\Max');
    expect(out).toContain('~\\bin\\openplanet-lsp.exe');
  });
});

/**
 * Choke-point regressions (B043).
 *
 * The per-shape tests above each pin one leak that shipped. These pin the
 * PROPERTY instead: redaction happens once, at render, for every field - so a
 * field added later cannot reach a public paste unredacted. Four successive
 * leaks came from each call site redacting for itself.
 */
describe('buildStatusReport redaction choke point', () => {
  const home = '/home/max';
  const poisoned = '/home/max/leak';

  it('leaks no home path from ANY string field', () => {
    const out = buildStatusReport({
      state: 'failed',
      failureReason: `failed at ${poisoned}`,
      serverPath: poisoned,
      serverSource: `resolved from ${poisoned}`,
      serverVersion: poisoned,
      typeDb: { core: poisoned, game: poisoned, source: poisoned },
      gameTarget: poisoned,
      signatureMode: poisoned,
      unused: poisoned,
      inactiveRegions: poisoned,
      defines: [poisoned],
      pluginRoots: [poisoned],
      workspaceFolders: [poisoned, `${poisoned}/two`],
      activeWorkspaceRoot: poisoned,
      extensionVersion: poisoned,
      vscodeVersion: poisoned,
      platform: 'linux',
      home,
    });
    expect(out, `leaked: ${out}`).not.toContain(home);
    expect(out).toContain('~/leak');
  });

  it('redacts every field for a symlinked home, via both aliases', () => {
    const out = buildStatusReport({
      state: 'ready',
      serverPath: '/mnt/data/max/bin/openplanet-lsp',
      workspaceFolders: ['/home/max/src'],
      platform: 'linux',
      homeAliases: ['/home/max', '/mnt/data/max'],
    });
    expect(out).not.toContain('/home/max');
    expect(out).not.toContain('/mnt/data/max');
  });

  it('still omits the failure line entirely when the server has not failed', () => {
    expect(buildStatusReport({ state: 'ready', platform: 'linux', home })).not.toContain('Failure');
  });
});
