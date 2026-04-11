import { describe, it, expect } from 'vitest';
import {
  extractCiCommands,
  extractJustCiCommands,
  compareCommandSets,
} from '../verify-ci-parity.js';

describe('extractCiCommands', () => {
  it('extracts unique pnpm/tsx commands from a minimal ci.yml', () => {
    const yaml = `
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format:check
  unit:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
`;
    const cmds = extractCiCommands(yaml);
    // pnpm install is infrastructure, excluded
    expect(cmds).toContain('pnpm lint');
    expect(cmds).toContain('pnpm format:check');
    expect(cmds).toContain('pnpm test');
    expect(cmds).not.toContain('pnpm install --frozen-lockfile');
  });
});

describe('extractJustCiCommands', () => {
  it('extracts the recipe lines of the ci: recipe', () => {
    const just = `
default:
    @just --list

lint:
    pnpm lint

test:
    pnpm test

format-check:
    pnpm format:check

typecheck:
    pnpm typecheck

verify-pkg-shape:
    pnpm exec tsx scripts/verify-pkg-shape.ts

verify-ci-parity:
    pnpm exec tsx scripts/verify-ci-parity.ts

ci: lint format-check typecheck test verify-pkg-shape verify-ci-parity
`;
    const cmds = extractJustCiCommands(just);
    expect(cmds).toContain('pnpm lint');
    expect(cmds).toContain('pnpm format:check');
    expect(cmds).toContain('pnpm typecheck');
    expect(cmds).toContain('pnpm test');
    expect(cmds).toContain('pnpm exec tsx scripts/verify-pkg-shape.ts');
    expect(cmds).toContain('pnpm exec tsx scripts/verify-ci-parity.ts');
  });
});

describe('compareCommandSets', () => {
  it('passes when ci.yml is a subset of just ci', () => {
    const result = compareCommandSets(
      new Set(['pnpm lint', 'pnpm test']),
      new Set(['pnpm lint', 'pnpm test', 'pnpm typecheck']),
    );
    expect(result.ok).toBe(true);
  });

  it('fails when ci.yml has a command not in just ci', () => {
    const result = compareCommandSets(
      new Set(['pnpm lint', 'pnpm new-thing']),
      new Set(['pnpm lint']),
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('pnpm new-thing');
  });
});
