import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('getPlatformArch', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>;
  let archSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    platformSpy = vi.spyOn(process, 'platform', 'get');
    archSpy = vi.spyOn(process, 'arch', 'get');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns linux-x64 on Linux x64', async () => {
    platformSpy.mockReturnValue('linux');
    archSpy.mockReturnValue('x64');
    const { getPlatformArch } = await import('../src/paths.js');
    expect(getPlatformArch()).toBe('linux-x64');
  });

  it('returns linux-arm64 on Linux aarch64', async () => {
    platformSpy.mockReturnValue('linux');
    archSpy.mockReturnValue('arm64');
    const { getPlatformArch } = await import('../src/paths.js');
    expect(getPlatformArch()).toBe('linux-arm64');
  });

  it('returns darwin-x64 on macOS Intel', async () => {
    platformSpy.mockReturnValue('darwin');
    archSpy.mockReturnValue('x64');
    const { getPlatformArch } = await import('../src/paths.js');
    expect(getPlatformArch()).toBe('darwin-x64');
  });

  it('returns darwin-arm64 on Apple Silicon', async () => {
    platformSpy.mockReturnValue('darwin');
    archSpy.mockReturnValue('arm64');
    const { getPlatformArch } = await import('../src/paths.js');
    expect(getPlatformArch()).toBe('darwin-arm64');
  });

  it('returns win32-x64 on Windows x64', async () => {
    platformSpy.mockReturnValue('win32');
    archSpy.mockReturnValue('x64');
    const { getPlatformArch } = await import('../src/paths.js');
    expect(getPlatformArch()).toBe('win32-x64');
  });

  it('returns win32-arm64 on Windows ARM', async () => {
    platformSpy.mockReturnValue('win32');
    archSpy.mockReturnValue('arm64');
    const { getPlatformArch } = await import('../src/paths.js');
    expect(getPlatformArch()).toBe('win32-arm64');
  });

  it('throws on an unsupported combination', async () => {
    platformSpy.mockReturnValue('freebsd' as NodeJS.Platform);
    archSpy.mockReturnValue('x64');
    const { getPlatformArch } = await import('../src/paths.js');
    expect(() => getPlatformArch()).toThrow(/unsupported/i);
  });
});

describe('getBinaryName', () => {
  it('returns openplanet-lsp on non-Windows', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get');
    platformSpy.mockReturnValue('linux');
    return import('../src/paths.js').then(({ getBinaryName }) => {
      expect(getBinaryName()).toBe('openplanet-lsp');
      platformSpy.mockRestore();
    });
  });

  it('returns openplanet-lsp.exe on Windows', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get');
    platformSpy.mockReturnValue('win32');
    return import('../src/paths.js').then(({ getBinaryName }) => {
      expect(getBinaryName()).toBe('openplanet-lsp.exe');
      platformSpy.mockRestore();
    });
  });
});
