import { describe, expect, it } from 'vitest';
import { abbreviateAll, abbreviateHome } from '../src/paths';

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
