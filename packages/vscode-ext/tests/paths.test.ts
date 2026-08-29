import { describe, expect, it } from 'vitest';
import { abbreviateAll, abbreviateHome, abbreviateHomeInText } from '../src/paths';

/**
 * `showStatus` output is written to be pasted into a public issue, so the
 * home-directory collapse is a privacy control, not cosmetics. The cases that
 * matter are the ones where a naive `startsWith` gets it wrong.
 */
describe('abbreviateHome', () => {
  const home = '/home/max';

  it('collapses the home prefix', () => {
    expect(abbreviateHome('/home/max/src/plugin', home, 'linux')).toBe('~/src/plugin');
  });

  it('collapses the home directory itself', () => {
    expect(abbreviateHome('/home/max', home, 'linux')).toBe('~');
  });

  it('tolerates a trailing separator on the home value', () => {
    expect(abbreviateHome('/home/max/src', '/home/max/', 'linux')).toBe('~/src');
  });

  it('does NOT collapse a sibling directory with the same prefix', () => {
    // The bug this guards: `~well/plugin`, which is both wrong AND still
    // leaks the username.
    expect(abbreviateHome('/home/maxwell/plugin', home, 'linux')).toBe('/home/maxwell/plugin');
  });

  it('leaves unrelated paths alone', () => {
    expect(abbreviateHome('/usr/local/bin/openplanet-lsp', home, 'linux')).toBe(
      '/usr/local/bin/openplanet-lsp',
    );
  });

  it('is case-insensitive and separator-agnostic on win32', () => {
    expect(abbreviateHome('C:\\Users\\Max\\src', 'c:/users/max', 'win32')).toBe('~\\src');
  });

  it('is case-SENSITIVE on posix', () => {
    expect(abbreviateHome('/home/Max/src', home, 'linux')).toBe('/home/Max/src');
  });

  it('returns the input when there is no home to strip', () => {
    expect(abbreviateHome('/home/max/src', undefined, 'linux')).toBe('/home/max/src');
    expect(abbreviateHome('/home/max/src', '', 'linux')).toBe('/home/max/src');
  });

  it('passes through undefined and empty paths', () => {
    expect(abbreviateHome(undefined, home, 'linux')).toBeUndefined();
    expect(abbreviateHome('', home, 'linux')).toBe('');
  });

  it('does not treat a bare separator home as a prefix', () => {
    // A home of "/" would otherwise turn every absolute path into "~...".
    expect(abbreviateHome('/opt/thing', '/', 'linux')).toBe('/opt/thing');
  });
});

describe('abbreviateAll', () => {
  it('maps and drops blanks', () => {
    expect(abbreviateAll(['/home/max/a', '', '  ', '/opt/b'], '/home/max', 'linux')).toEqual([
      '~/a',
      '/opt/b',
    ]);
  });

  it('returns an empty list for undefined', () => {
    expect(abbreviateAll(undefined, '/home/max', 'linux')).toEqual([]);
  });
});

describe('abbreviateHomeInText', () => {
  it('redacts home paths embedded in diagnostics without mangling siblings', () => {
    expect(
      abbreviateHomeInText(
        'spawn failed for /home/max/bin/openplanet-lsp; retry /home/maxwell/bin/openplanet-lsp',
        ['/home/max/'],
        'linux',
      ),
    ).toBe('spawn failed for ~/bin/openplanet-lsp; retry /home/maxwell/bin/openplanet-lsp');
  });

  it('redacts every occurrence of the same home path in one diagnostic', () => {
    expect(
      abbreviateHomeInText(
        'read /home/max/.config/openplanet after spawning /home/max/bin/openplanet-lsp',
        ['/home/max'],
        'linux',
      ),
    ).toBe('read ~/.config/openplanet after spawning ~/bin/openplanet-lsp');
  });

  it('redacts a home path when diagnostics render it as a file URI', () => {
    expect(
      abbreviateHomeInText('failed to read file:///home/max/src/Main.as', ['/home/max'], 'linux'),
    ).toBe('failed to read file://~/src/Main.as');
  });

  it('redacts Windows aliases case-insensitively with either separator', () => {
    expect(
      abbreviateHomeInText(
        'spawn C:/USERS/max/bin/openplanet-lsp.exe failed',
        ['C:\\Users\\Max'],
        'win32',
      ),
    ).toBe('spawn ~/bin/openplanet-lsp.exe failed');
  });

  it('redacts standalone home aliases before terminal prose punctuation without matching siblings', () => {
    expect(
      abbreviateHomeInText(
        'failed to open /home/max. Retry after fixing permissions.',
        ['/home/max'],
        'linux',
      ),
    ).toBe('failed to open ~. Retry after fixing permissions.');
    expect(
      abbreviateHomeInText('failed to open /home/max, retry later', ['/home/max'], 'linux'),
    ).toBe('failed to open ~, retry later');
    expect(abbreviateHomeInText('failed to open (/home/max)', ['/home/max'], 'linux')).toBe(
      'failed to open (~)',
    );
    expect(
      abbreviateHomeInText(
        'failed to open C:\\Users\\Max, retry later',
        ['C:\\Users\\Max'],
        'win32',
      ),
    ).toBe('failed to open ~, retry later');
    expect(abbreviateHomeInText('failed to open (C:/Users/Max)', ['C:\\Users\\Max'], 'win32')).toBe(
      'failed to open (~)',
    );
    expect(
      abbreviateHomeInText('failed to open /home/maxwell (EACCES)', ['/home/max'], 'linux'),
    ).toBe('failed to open /home/maxwell (EACCES)');
    expect(
      abbreviateHomeInText(
        'failed to open C:/Users/Maxwell, retry later',
        ['C:\\Users\\Max'],
        'win32',
      ),
    ).toBe('failed to open C:/Users/Maxwell, retry later');
    expect(
      abbreviateHomeInText(
        'failed to open C:/Users/Max. Retry after fixing permissions.',
        ['C:\\Users\\Max'],
        'win32',
      ),
    ).toBe('failed to open ~. Retry after fixing permissions.');
  });

  it('does not redact hyphenated sibling paths on POSIX or Windows', () => {
    expect(
      abbreviateHomeInText(
        'failed to open /home/max-backup (EACCES); retry /home/max/bin/openplanet-lsp',
        ['/home/max'],
        'linux',
      ),
    ).toBe('failed to open /home/max-backup (EACCES); retry ~/bin/openplanet-lsp');
    expect(
      abbreviateHomeInText(
        'failed to open C:\\Users\\Max-backup: access denied; retry C:\\Users\\Max\\bin\\openplanet-lsp.exe',
        ['C:\\Users\\Max'],
        'win32',
      ),
    ).toBe('failed to open C:\\Users\\Max-backup: access denied; retry ~\\bin\\openplanet-lsp.exe');
  });

  it('keeps ordinary dotted sibling names intact while redacting continued child paths', () => {
    expect(
      abbreviateHomeInText(
        'failed to open /home/max.backup; retry /home/max/bin/openplanet-lsp',
        ['/home/max'],
        'linux',
      ),
    ).toBe('failed to open /home/max.backup; retry ~/bin/openplanet-lsp');
    expect(
      abbreviateHomeInText(
        'failed to open C:\\Users\\Max.backup; retry C:\\Users\\Max\\bin\\openplanet-lsp.exe',
        ['C:\\Users\\Max'],
        'win32',
      ),
    ).toBe('failed to open C:\\Users\\Max.backup; retry ~\\bin\\openplanet-lsp.exe');
  });

  it('redacts a canonical home alias when HOME itself is a symlink', () => {
    expect(
      abbreviateHomeInText(
        'type DB read from /physical/users/max/OpenplanetNext',
        ['/home/max-link', '/physical/users/max'],
        'linux',
      ),
    ).toBe('type DB read from ~/OpenplanetNext');
  });
});

/**
 * Diagnostic prose corpus (B043).
 *
 * The four preceding redaction fixes each patched one shape of prose, so this
 * pins the property instead of another example: whatever punctuation a server
 * error, a spawn failure or an env-var dump puts in front of a path, the home
 * directory must not survive into text a user pastes into a public issue.
 *
 * A missed redaction publishes the user's account name. A false redaction is
 * cosmetic damage to a diagnostic dump. The rules below are therefore
 * deliberately asymmetric, and the negatives that follow are the ones where a
 * false redaction would ALSO leak (a sibling directory mangled into `~well`).
 */
const LEAKY_PROSE: [name: string, text: string][] = [
  ['spawn error', 'spawn /home/max/.local/bin/openplanet-lsp ENOENT'],
  ['key=value', 'cwd=/home/max/src/plugin'],
  ['setting=value', 'serverPath=/home/max/bin/openplanet-lsp'],
  ['label:value', 'launching:/home/max/bin/x'],
  ['env var', 'HOME=/home/max'],
  ['colon-separated list', 'PATH=/usr/bin:/home/max/bin'],
  ['comma-separated pairs', 'a=/home/max,b=/home/max/x'],
  ['flag-adjacent', 'ELOOP -/home/max/x'],
  ['at-separated', 'user@/home/max/y'],
  ['file URI', 'file:///home/max/src/Main.as'],
  ['quoted', "Error: EACCES, open '/home/max/x'"],
  ['end of sentence', 'could not read /home/max.'],
  ['parenthesised', 'failed to open /home/max (EACCES)'],
];

describe('abbreviateHomeInText over realistic diagnostic prose', () => {
  const home = '/home/max';

  it.each(LEAKY_PROSE)('redacts the home directory in a %s', (_name, text) => {
    const out = abbreviateHomeInText(text, [home], 'linux');
    expect(out, `leaked in: ${JSON.stringify(out)}`).not.toContain(home);
  });

  it('keeps a sibling directory intact rather than mangling it', () => {
    // `/home/maxwell` must survive whole: a partial replacement would read
    // `~well` and still name the account.
    const out = abbreviateHomeInText('read /home/maxwell/x then /home/max/y', [home], 'linux');
    expect(out).toBe('read /home/maxwell/x then ~/y');
  });

  it('keeps a sibling that differs only after a dot', () => {
    const out = abbreviateHomeInText('open /home/max.backup/x', [home], 'linux');
    expect(out).toBe('open /home/max.backup/x');
  });

  it('does not rewrite an unrelated path that merely contains the home path', () => {
    // /mnt/backup/home/max is somebody's archive, not this user's home.
    const out = abbreviateHomeInText('restore /mnt/backup/home/max/x', [home], 'linux');
    expect(out).toBe('restore /mnt/backup/home/max/x');
  });

  it('redacts every alias, so a symlinked home is covered both ways', () => {
    const out = abbreviateHomeInText(
      'cwd=/mnt/data/max/src and bin=/home/max/bin',
      ['/home/max', '/mnt/data/max'],
      'linux',
    );
    expect(out).toBe('cwd=~/src and bin=~/bin');
  });

  it('redacts a windows home behind a key=value', () => {
    const out = abbreviateHomeInText(
      'serverPath=C:\\Users\\Max\\bin\\openplanet-lsp.exe',
      ['C:\\Users\\max'],
      'win32',
    );
    expect(out).toBe('serverPath=~\\bin\\openplanet-lsp.exe');
  });
});
