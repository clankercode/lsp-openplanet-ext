import { describe, expect, it, vi } from 'vitest';

import {
  RESOLVED_DEFINES_METHOD,
  parseResolvedDefines,
  requestResolvedDefines,
  type DefinesRequestClient,
} from '../src/resolvedDefines';

/**
 * The `openplanet/resolvedDefines` client (B050).
 *
 * Two things are load-bearing and are what this file pins:
 *
 * 1. **A missing or broken answer never throws.** The bundled server can be
 *    older than the extension, `openplanetLsp.serverPath` can point at any
 *    build, and the client can be mid-restart. All of those must degrade to
 *    B034's overrides-only view, not break Manage Defines.
 * 2. **The wire shape is the contract with the Rust `ResolvedDefine`.** The
 *    field names here are asserted verbatim, so a serde rename on either side
 *    fails a test instead of silently producing empty rows.
 */

/** A server answer in exactly the shape `src/config.rs` serializes. */
const WIRE = {
  defines: [
    { name: 'TMNEXT', active: true, origin: 'target', derivedActive: true },
    { name: 'LOGS', active: false, origin: 'build', derivedActive: true },
    { name: 'DEPENDENCY_MLHOOK', active: true, origin: 'dependency', derivedActive: true },
    { name: 'DEPENDENCY_GONE', active: false, origin: 'dependency-missing', derivedActive: false },
    { name: 'MY_FLAG', active: true, origin: 'user', derivedActive: false },
  ],
  gameTarget: 'TMNEXT',
  platformFamilies: [['TMNEXT'], ['MP4', 'MP40', 'MP41'], ['TURBO']],
};

function clientReturning(value: unknown): DefinesRequestClient {
  return { sendRequest: vi.fn().mockResolvedValue(value) };
}

describe('parseResolvedDefines', () => {
  it('accepts the server wire shape verbatim', () => {
    const parsed = parseResolvedDefines(WIRE);
    expect(parsed?.gameTarget).toBe('TMNEXT');
    expect(parsed?.defines).toHaveLength(5);
    expect(parsed?.defines[0]).toEqual({
      name: 'TMNEXT',
      active: true,
      origin: 'target',
      derivedActive: true,
    });
    expect(parsed?.platformFamilies).toEqual([['TMNEXT'], ['MP4', 'MP40', 'MP41'], ['TURBO']]);
  });

  it('keeps present-but-disabled distinct from absent', () => {
    const parsed = parseResolvedDefines(WIRE);
    const logs = parsed?.defines.find((d) => d.name === 'LOGS');
    // The whole point of the request: a define the user turned off is a ROW
    // that is off, carrying the state it would have had without the override.
    expect(logs).toEqual({ name: 'LOGS', active: false, origin: 'build', derivedActive: true });
    expect(parsed?.defines.find((d) => d.name === 'NOT_A_DEFINE')).toBeUndefined();
  });

  it('reports a declared-but-uninstalled dependency as inactive', () => {
    const gone = parseResolvedDefines(WIRE)?.defines.find((d) => d.name === 'DEPENDENCY_GONE');
    expect(gone?.origin).toBe('dependency-missing');
    expect(gone?.active).toBe(false);
    expect(gone?.derivedActive).toBe(false);
  });

  it.each([undefined, null, 42, 'nope', {}, { defines: 'no' }, []])(
    'returns undefined for an unusable payload (%p)',
    (payload) => {
      expect(parseResolvedDefines(payload)).toBeUndefined();
    },
  );

  it('maps an origin this build does not know to `unknown` rather than dropping the row', () => {
    // A server newer than the extension. A define whose origin cannot be
    // labelled is still a define the user needs to see and toggle.
    const parsed = parseResolvedDefines({
      defines: [{ name: 'FUTURE', active: true, origin: 'time-travel', derivedActive: true }],
    });
    expect(parsed?.defines).toEqual([
      { name: 'FUTURE', active: true, origin: 'unknown', derivedActive: true },
    ]);
  });

  it('drops individual malformed rows but keeps the usable ones', () => {
    const parsed = parseResolvedDefines({
      defines: [
        { name: 'GOOD', active: true, origin: 'build', derivedActive: true },
        { name: '', active: true },
        { active: true, origin: 'build' },
        { name: 'NO_STATE', origin: 'build' },
        'not an object',
      ],
    });
    // A partial derived set still beats the user's array alone.
    expect(parsed?.defines.map((d) => d.name)).toEqual(['GOOD']);
  });

  it('treats a missing derivedActive as unknown, not as false', () => {
    // `undefined` makes `applyDefineEdit` write an EXPLICIT entry; `false`
    // would make it write a minimal one off a state nobody reported.
    const parsed = parseResolvedDefines({ defines: [{ name: 'X', active: true }] });
    expect(parsed?.defines[0].derivedActive).toBeUndefined();
  });

  it('tolerates a missing gameTarget and platformFamilies', () => {
    const parsed = parseResolvedDefines({ defines: [] });
    expect(parsed).toEqual({ defines: [], gameTarget: '', platformFamilies: [] });
  });

  it('drops non-string and empty families', () => {
    const parsed = parseResolvedDefines({
      defines: [],
      platformFamilies: [['MP4', 7, 'MP41'], [], 'nope', ['TURBO']],
    });
    expect(parsed?.platformFamilies).toEqual([['MP4', 'MP41'], ['TURBO']]);
  });
});

describe('requestResolvedDefines', () => {
  it('sends the namespaced method with the uri as params', async () => {
    const client = clientReturning(WIRE);
    await requestResolvedDefines(client, 'file:///ws/plugin/src/Main.as');
    // tower-lsp's typed router rejects a request with NO params member, so an
    // object is always sent even when there is no uri to put in it.
    expect(client.sendRequest).toHaveBeenCalledWith(RESOLVED_DEFINES_METHOD, {
      uri: 'file:///ws/plugin/src/Main.as',
    });
    expect(RESOLVED_DEFINES_METHOD).toBe('openplanet/resolvedDefines');
  });

  it('still sends a params object when there is no uri', async () => {
    const client = clientReturning(WIRE);
    await requestResolvedDefines(client);
    expect(client.sendRequest).toHaveBeenCalledWith(RESOLVED_DEFINES_METHOD, { uri: undefined });
  });

  it('returns undefined and logs when there is no client', async () => {
    const log = vi.fn();
    await expect(requestResolvedDefines(undefined, undefined, log)).resolves.toBeUndefined();
    expect(log.mock.calls.flat().join(' ')).toContain('overrides only');
  });

  it('returns undefined when the server rejects the method', async () => {
    // Every server built before B050: the router answers MethodNotFound and
    // vscode-languageclient turns that into a rejection.
    const log = vi.fn();
    const client: DefinesRequestClient = {
      sendRequest: vi
        .fn()
        .mockRejectedValue(new Error('Unhandled method openplanet/resolvedDefines')),
    };
    await expect(requestResolvedDefines(client, undefined, log)).resolves.toBeUndefined();
    expect(log.mock.calls.flat().join(' ')).toContain('unavailable');
  });

  it('returns undefined for a payload it cannot use', async () => {
    const log = vi.fn();
    await expect(
      requestResolvedDefines(clientReturning({ nope: true }), undefined, log),
    ).resolves.toBeUndefined();
    expect(log.mock.calls.flat().join(' ')).toContain('unusable');
  });

  it('never rejects, whatever the client throws synchronously', async () => {
    const client: DefinesRequestClient = {
      sendRequest: vi.fn(() => {
        throw new Error('client is disposed');
      }),
    };
    await expect(requestResolvedDefines(client)).resolves.toBeUndefined();
  });
});
