# lsp-openplanet-ext — M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the pnpm monorepo skeleton, a fully-tested `binary-resolver` package, complete CI workflow files (with publish jobs as disabled-or-secret-gated stubs), a `justfile` that mirrors CI locally, and documentation scaffolding — such that `just ci` passes green both locally and in GitHub Actions on a fresh clone.

**Architecture:** pnpm workspace at the repo root; TypeScript with ESM throughout; `binary-resolver` is the first real package, developed TDD with vitest; CI workflows land complete from day one with all publish jobs gated on secrets or labels so they run cleanly without any secrets configured. A `verify-ci-parity.ts` meta-script enforces that `just ci` ≡ `ci.yml` to prevent drift.

**Tech Stack:** Node ≥20, pnpm 9, TypeScript 5.4+, vitest 2, ESLint 9 (flat config) via `typescript-eslint` helper, Prettier 3, `tsx` for script execution, `just` as the local task runner, GitHub Actions.

**Spec reference:** `docs/superpowers/specs/2026-04-11-lsp-openplanet-ext-design.md` sections 1, 2, 3, 7, 9, 11.

**Exit criterion:** On a fresh clone, `pnpm install && just ci` exits 0 on Linux/macOS/Windows; pushing to GitHub runs `ci.yml` to completion green; all publish workflow files exist and skip cleanly without secrets.

---

## File Structure

```
lsp-openplanet-ext/
├── .editorconfig
├── .gitignore
├── .prettierrc
├── .prettierignore
├── BINARY_REF                           # "v0.2.0"
├── LICENSE                              # UNLICENSE
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── eslint.config.js
├── justfile
├── package.json                         # workspace root
├── pnpm-workspace.yaml
├── pnpm-lock.yaml                       # generated
├── tsconfig.base.json
├── .github/workflows/
│   ├── ci.yml                           # complete, runs on every PR
│   ├── integration.yml                  # stub, labeled-only trigger
│   ├── build-binaries.yml               # stub, reusable workflow
│   ├── release.yml                      # stub, tag-triggered
│   ├── publish-npm.yml                  # stub, gated on NPM_TOKEN
│   ├── publish-vsce.yml                 # stub, gated on VSCE_PAT
│   ├── publish-ovsx.yml                 # stub, gated on OVSX_PAT
│   ├── nightly.yml                      # stub, disabled via if: false
│   └── codeql.yml                       # complete, no secrets needed
├── docs/
│   ├── editor-setup/.gitkeep
│   ├── internal/.gitkeep
│   └── superpowers/
│       ├── specs/                       # already exists; spec lives here
│       └── plans/                       # this plan lives here
├── packages/
│   └── binary-resolver/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── src/
│       │   ├── index.ts                 # public exports
│       │   ├── types.ts                 # ResolveOptions, ResolveResult, ResolveSource
│       │   ├── errors.ts                # BinaryNotFoundError
│       │   ├── paths.ts                 # platform/arch helpers, binary name suffix
│       │   ├── version.ts               # parseVersion, checkBinaryVersion
│       │   └── resolve.ts               # resolveBinary
│       └── tests/
│           ├── paths.test.ts
│           ├── errors.test.ts
│           ├── version.test.ts
│           ├── resolve.test.ts
│           ├── index.test.ts
│           └── fixtures/
│               ├── fake-binary-ok.mjs   # prints "openplanet-lsp 0.2.0"
│               └── fake-binary-bad.mjs  # exits non-zero
└── scripts/
    ├── tsconfig.json                    # allows .ts scripts via tsx
    ├── verify-pkg-shape.ts              # package.json shape check
    └── verify-ci-parity.ts              # just ci ≡ ci.yml meta-test
```

Responsibilities:

- **`binary-resolver`** — pure TypeScript module, no runtime I/O beyond spawning a binary for `checkBinaryVersion`. All path resolution logic lives here and only here.
- **`scripts/`** — repo-level validation utilities run via `tsx`.
- **`ci.yml`** — the only CI workflow that actually runs on every PR in M1; everything else is a stub that proves the YAML parses and the triggers are correct.
- **`justfile`** — the local CI surface. Every command `ci.yml` runs must also be invokable via `just`.

---

## Task 1: Initialize repository, gitignore, license, binary ref

**Files:**
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `BINARY_REF`

The repo already exists with the design spec committed. This task adds the foundational files required before any tooling.

- [ ] **Step 1: Create `.gitignore`**

```
# Node
node_modules/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
.pnpm-store/

# Build outputs
dist/
*.tsbuildinfo

# Cache
.cache/
.turbo/
.vite/
coverage/

# Editor
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json.example
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Workspace-local secrets
.env
.env.local

# Platform package binaries (populated by CI at release time)
packages/npm-lsp-platforms/*/bin/
packages/vscode-ext/bin/
```

- [ ] **Step 2: Create `LICENSE`**

```
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
```

- [ ] **Step 3: Create `BINARY_REF`**

```
v0.2.0
```

(Single line, no trailing comment. This file is read by CI and dev scripts to know which `openplanet-lsp` git tag to build the binary from.)

- [ ] **Step 4: Commit**

```bash
git add .gitignore LICENSE BINARY_REF
git commit -m "Add gitignore, UNLICENSE, and BINARY_REF pointing at openplanet-lsp v0.2.0"
```

---

## Task 2: Workspace root, TypeScript base config, editor config

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.editorconfig`

- [ ] **Step 1: Create `package.json` (workspace root)**

```json
{
  "name": "lsp-openplanet-ext",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "exclude": ["node_modules", "dist", ".cache"]
}
```

- [ ] **Step 4: Create `.editorconfig`**

```
root = true

[*]
end_of_line = lf
insert_final_newline = true
charset = utf-8
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab

[justfile]
indent_style = space
indent_size = 4
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .editorconfig
git commit -m "Set up pnpm workspace root, tsconfig.base, editorconfig"
```

---

## Task 3: Install root dev dependencies

**Files:**
- Modify: `package.json`
- Create: `pnpm-lock.yaml`

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
pnpm add -Dw \
  typescript@^5.4.0 \
  @types/node@^20.0.0 \
  tsx@^4.0.0 \
  vitest@^2.0.0 \
  eslint@^9.0.0 \
  typescript-eslint@^8.0.0 \
  prettier@^3.0.0
```

- [ ] **Step 2: Verify `package.json` now has a `devDependencies` block**

Run:
```bash
cat package.json
```
Expected: `"devDependencies"` block present with all 7 packages.

- [ ] **Step 3: Verify lockfile exists**

Run:
```bash
ls pnpm-lock.yaml
```
Expected: file exists.

- [ ] **Step 4: Verify TypeScript and vitest are runnable**

Run:
```bash
pnpm exec tsc --version
pnpm exec vitest --version
```
Expected: version strings for each.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Install root dev dependencies (typescript, vitest, eslint, prettier, tsx)"
```

---

## Task 4: Lint and format configuration

**Files:**
- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `.prettierignore`

- [ ] **Step 1: Create `eslint.config.js`** (ESLint 9 flat config via typescript-eslint helper)

```js
// eslint.config.js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.cache/**',
      'pnpm-lock.yaml',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  }
);
```

- [ ] **Step 2: Create `.prettierrc`**

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "semi": true,
  "printWidth": 100,
  "tabWidth": 2,
  "endOfLine": "lf"
}
```

- [ ] **Step 3: Create `.prettierignore`**

```
node_modules
dist
.cache
pnpm-lock.yaml
coverage
docs/
.goal-loops/
```

Note: `docs/` is excluded because the design spec and implementation plans are hand-authored long-form markdown with careful table/code-block layout that Prettier's line-wrapping would damage. `.goal-loops/` is transient planning-system state that lives outside the repo's committed surface.

- [ ] **Step 4: Verify lint runs on an empty repo without errors**

Run:
```bash
pnpm lint
```
Expected: exit 0, no output (or an informational "no files to lint" message — either is acceptable).

- [ ] **Step 5: Verify prettier check runs**

Run:
```bash
pnpm format:check
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.js .prettierrc .prettierignore
git commit -m "Add ESLint flat config and Prettier config"
```

---

## Task 5: Minimal justfile

**Files:**
- Create: `justfile`

This is the first iteration — install, test, lint, typecheck, clean. `ci` target is wired up in Task 19 after `verify-ci-parity` exists.

- [ ] **Step 1: Create `justfile`**

```makefile
# List all recipes (default when you run `just` with no args)
default:
    @just --list

# ─── setup ────────────────────────────────────────────────────────────────
install:
    pnpm install

clean:
    rm -rf node_modules packages/*/node_modules packages/*/dist .cache

# ─── build / test / lint ──────────────────────────────────────────────────
build:
    pnpm -r build

test:
    pnpm -r test

lint:
    pnpm lint

format:
    pnpm format

format-check:
    pnpm format:check

typecheck:
    pnpm -r typecheck
```

- [ ] **Step 2: Verify `just --list` parses the file**

Run:
```bash
just --list
```
Expected: lists `default`, `install`, `clean`, `build`, `test`, `lint`, `format`, `format-check`, `typecheck`.

- [ ] **Step 3: Verify `just lint` works**

Run:
```bash
just lint
```
Expected: exit 0 (same behaviour as `pnpm lint`).

- [ ] **Step 4: Commit**

```bash
git add justfile
git commit -m "Add minimal justfile with install/build/test/lint/typecheck/clean targets"
```

---

## Task 6: Scaffold `binary-resolver` package

**Files:**
- Create: `packages/binary-resolver/package.json`
- Create: `packages/binary-resolver/tsconfig.json`
- Create: `packages/binary-resolver/vitest.config.ts`
- Create: `packages/binary-resolver/src/index.ts`

- [ ] **Step 1: Create `packages/binary-resolver/package.json`**

```json
{
  "name": "binary-resolver",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create `packages/binary-resolver/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "tests"]
}
```

- [ ] **Step 3: Create `packages/binary-resolver/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create a minimal `src/index.ts`**

```ts
// Public surface; filled in as modules land.
export {};
```

- [ ] **Step 5: Install workspace**

Run:
```bash
pnpm install
```
Expected: pnpm resolves `binary-resolver` as a workspace package.

- [ ] **Step 6: Verify typecheck passes with an empty module**

Run:
```bash
pnpm -F binary-resolver typecheck
```
Expected: exit 0, no output.

- [ ] **Step 7: Verify vitest runs with no tests**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: "No test files found" — exit code 0. (vitest 2.x exits 0 by default when no tests are discovered; if your version exits non-zero, add `--passWithNoTests` in the npm script.)

If this exits non-zero, modify `packages/binary-resolver/package.json` scripts.test to:
```json
"test": "vitest run --passWithNoTests",
```

- [ ] **Step 8: Commit**

```bash
git add packages/binary-resolver/ pnpm-lock.yaml
git commit -m "Scaffold binary-resolver package (tsconfig, vitest config, empty index)"
```

---

## Task 7: `paths.ts` — platform detection and binary name helpers

**Files:**
- Create: `packages/binary-resolver/src/paths.ts`
- Create: `packages/binary-resolver/tests/paths.test.ts`

- [ ] **Step 1: Write the failing test first** (`tests/paths.test.ts`)

```ts
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
```

Note: The dynamic `await import` pattern is used so the module reads `process.platform` *after* the spy is installed. If you use a static top-level import, the module-eval-time reads bypass the spy.

- [ ] **Step 2: Run the test — expect failure**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: FAIL with "Cannot find module ../src/paths.js" (or similar).

- [ ] **Step 3: Implement `src/paths.ts`**

```ts
export type PlatformArch =
  | 'linux-x64'
  | 'linux-arm64'
  | 'darwin-x64'
  | 'darwin-arm64'
  | 'win32-x64'
  | 'win32-arm64';

const SUPPORTED: ReadonlySet<string> = new Set([
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
]);

export function getPlatformArch(): PlatformArch {
  const key = `${process.platform}-${process.arch}`;
  if (!SUPPORTED.has(key)) {
    throw new Error(
      `unsupported platform/arch combination: ${key}. ` +
        `Supported: ${[...SUPPORTED].join(', ')}`,
    );
  }
  return key as PlatformArch;
}

export function getBinaryName(): string {
  return process.platform === 'win32' ? 'openplanet-lsp.exe' : 'openplanet-lsp';
}
```

- [ ] **Step 4: Run the test — expect pass**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: all tests in `paths.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add packages/binary-resolver/src/paths.ts packages/binary-resolver/tests/paths.test.ts
git commit -m "Add binary-resolver paths module (getPlatformArch, getBinaryName)"
```

---

## Task 8: `errors.ts` — `BinaryNotFoundError`

**Files:**
- Create: `packages/binary-resolver/src/errors.ts`
- Create: `packages/binary-resolver/tests/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/errors.test.ts
import { describe, it, expect } from 'vitest';
import { BinaryNotFoundError } from '../src/errors.js';

describe('BinaryNotFoundError', () => {
  it('is an instance of Error', () => {
    const err = new BinaryNotFoundError({ checkedLocations: [] });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BinaryNotFoundError');
  });

  it('exposes checkedLocations on the instance', () => {
    const locs = [
      { source: 'override' as const, path: '/bad/path', reason: 'file not found' },
      { source: 'vscode-bundle' as const, path: '/ext/bin/openplanet-lsp', reason: 'not set' },
    ];
    const err = new BinaryNotFoundError({ checkedLocations: locs });
    expect(err.checkedLocations).toEqual(locs);
  });

  it('builds a structured multi-line message listing every checked location', () => {
    const err = new BinaryNotFoundError({
      checkedLocations: [
        { source: 'override', path: '/bad/path', reason: 'file not found' },
        { source: 'npm-platform-pkg', path: '@openplanet-lsp/linux-x64', reason: 'not installed' },
      ],
    });
    expect(err.message).toContain('openplanet-lsp binary not found');
    expect(err.message).toContain('override');
    expect(err.message).toContain('/bad/path');
    expect(err.message).toContain('file not found');
    expect(err.message).toContain('npm-platform-pkg');
    expect(err.message).toContain('@openplanet-lsp/linux-x64');
  });

  it('handles empty checkedLocations without crashing', () => {
    const err = new BinaryNotFoundError({ checkedLocations: [] });
    expect(err.message).toContain('openplanet-lsp binary not found');
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/errors.ts`**

```ts
import type { ResolveSource } from './types.js';

export interface CheckedLocation {
  source: ResolveSource;
  path: string;
  reason: string;
}

export interface BinaryNotFoundErrorInit {
  checkedLocations: readonly CheckedLocation[];
}

export class BinaryNotFoundError extends Error {
  public readonly checkedLocations: readonly CheckedLocation[];

  constructor(init: BinaryNotFoundErrorInit) {
    const message = buildMessage(init.checkedLocations);
    super(message);
    this.name = 'BinaryNotFoundError';
    this.checkedLocations = init.checkedLocations;
    Object.setPrototypeOf(this, BinaryNotFoundError.prototype);
  }
}

function buildMessage(locations: readonly CheckedLocation[]): string {
  const header = 'openplanet-lsp binary not found.';
  if (locations.length === 0) {
    return `${header} No resolution sources were attempted.`;
  }
  const lines = locations.map(
    (loc) => `  - ${loc.source} (${loc.path}): ${loc.reason}`,
  );
  return [`${header} Checked:`, ...lines].join('\n');
}
```

This file imports `ResolveSource` from `./types.js` — that module is created in Task 9. The compiler errors until types.ts exists. That's fine because Task 9 is next; we'll run tests after both land.

Alternative: declare a local `type ResolveSource = string` in this file now and replace it in Task 9. Not worth the churn — just let the next task close the loop.

- [ ] **Step 4: Skip running tests until Task 9 completes**

The compilation gap is closed by the very next task. Do not run tests between Task 8 and Task 9.

- [ ] **Step 5: Commit**

```bash
git add packages/binary-resolver/src/errors.ts packages/binary-resolver/tests/errors.test.ts
git commit -m "Add BinaryNotFoundError with structured checkedLocations"
```

---

## Task 9: `types.ts` — public type exports

**Files:**
- Create: `packages/binary-resolver/src/types.ts`

Types don't need their own vitest coverage — they're verified by the TypeScript compiler when downstream modules use them. This task unblocks the compile of `errors.ts` from Task 8.

- [ ] **Step 1: Create `src/types.ts`**

```ts
export type ResolveSource =
  | 'override'
  | 'vscode-bundle'
  | 'npm-platform-pkg'
  | 'path';

export interface ResolveOptions {
  /** Explicit override; wins over everything if provided and the file exists. */
  override?: string;

  /**
   * For VSCode: path to the extension's install dir, containing bin/openplanet-lsp[.exe].
   * For npm: not used.
   */
  extensionPath?: string;

  /** Optional logger so callers can see why a particular path was chosen. */
  log?: (msg: string) => void;
}

export interface ResolveResult {
  /** Absolute path to the binary; verified to exist. */
  path: string;
  /** Which branch of the resolver produced this path. */
  source: ResolveSource;
  /** Result of parsing `<bin> --version`, if resolvable. Optional (not all callers need it). */
  version?: string;
}
```

- [ ] **Step 2: Run typecheck + tests**

Run:
```bash
pnpm -F binary-resolver typecheck
pnpm -F binary-resolver test
```
Expected: typecheck passes, `errors.test.ts` + `paths.test.ts` pass.

- [ ] **Step 3: Commit**

```bash
git add packages/binary-resolver/src/types.ts
git commit -m "Add binary-resolver public type exports"
```

---

## Task 10: `version.ts` — `parseVersion`

**Files:**
- Create: `packages/binary-resolver/src/version.ts`
- Create: `packages/binary-resolver/tests/version.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/version.test.ts
import { describe, it, expect } from 'vitest';
import { parseVersion } from '../src/version.js';

describe('parseVersion', () => {
  it('parses the canonical openplanet-lsp output', () => {
    expect(parseVersion('openplanet-lsp 0.2.0')).toBe('0.2.0');
  });

  it('trims surrounding whitespace and trailing newline', () => {
    expect(parseVersion('  openplanet-lsp 0.2.0\n')).toBe('0.2.0');
  });

  it('handles a v-prefix gracefully', () => {
    expect(parseVersion('openplanet-lsp v0.2.0')).toBe('0.2.0');
  });

  it('returns undefined for non-matching output', () => {
    expect(parseVersion('garbage')).toBeUndefined();
    expect(parseVersion('')).toBeUndefined();
  });

  it('returns undefined when the version token is missing', () => {
    expect(parseVersion('openplanet-lsp')).toBeUndefined();
  });

  it('extracts only the version even with a build suffix', () => {
    expect(parseVersion('openplanet-lsp 0.2.0-dev.1')).toBe('0.2.0-dev.1');
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `parseVersion` in `src/version.ts`**

```ts
/**
 * Parses the output of `openplanet-lsp --version`.
 * Canonical form: "openplanet-lsp 0.2.0"
 * Also tolerates: leading/trailing whitespace, `v` prefix on the version, build suffixes.
 */
export function parseVersion(output: string): string | undefined {
  const trimmed = output.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return undefined;
  const raw = parts[1];
  if (!raw) return undefined;
  const stripped = raw.startsWith('v') ? raw.slice(1) : raw;
  if (!/^\d+\.\d+/.test(stripped)) return undefined;
  return stripped;
}
```

- [ ] **Step 4: Run the test — expect pass**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: all `parseVersion` tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/binary-resolver/src/version.ts packages/binary-resolver/tests/version.test.ts
git commit -m "Add parseVersion with tolerant whitespace/v-prefix handling"
```

---

## Task 11: `version.ts` — `checkBinaryVersion`

**Files:**
- Modify: `packages/binary-resolver/src/version.ts`
- Modify: `packages/binary-resolver/tests/version.test.ts`
- Create: `packages/binary-resolver/tests/fixtures/fake-binary-ok.mjs`
- Create: `packages/binary-resolver/tests/fixtures/fake-binary-bad.mjs`

- [ ] **Step 1: Create the fixture binaries**

`tests/fixtures/fake-binary-ok.mjs`:
```js
#!/usr/bin/env node
// Mimics `openplanet-lsp --version`.
if (process.argv.includes('--version') || process.argv.includes('-V')) {
  process.stdout.write('openplanet-lsp 0.2.0\n');
  process.exit(0);
}
process.exit(0);
```

`tests/fixtures/fake-binary-bad.mjs`:
```js
#!/usr/bin/env node
process.stderr.write('boom\n');
process.exit(1);
```

Make the fixtures executable:
```bash
chmod +x packages/binary-resolver/tests/fixtures/fake-binary-ok.mjs \
         packages/binary-resolver/tests/fixtures/fake-binary-bad.mjs
```

Note: on Windows these are spawned via Node directly; the shebang is cosmetic. The `checkBinaryVersion` implementation uses `execFile` which spawns the binary with its own argv. For `.mjs` fixtures we invoke `node <fixture>` explicitly in tests.

- [ ] **Step 2: Add failing tests for `checkBinaryVersion`**

Append to `tests/version.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { checkBinaryVersion } from '../src/version.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureOk = join(here, 'fixtures', 'fake-binary-ok.mjs');
const fixtureBad = join(here, 'fixtures', 'fake-binary-bad.mjs');

describe('checkBinaryVersion', () => {
  it('reports ok=true when actual version equals expected', async () => {
    const result = await checkBinaryVersion(
      process.execPath,
      '0.2.0',
      [fixtureOk],
    );
    expect(result.ok).toBe(true);
    expect(result.actual).toBe('0.2.0');
    expect(result.expected).toBe('0.2.0');
  });

  it('reports ok=false when actual version differs from expected', async () => {
    const result = await checkBinaryVersion(
      process.execPath,
      '0.1.0',
      [fixtureOk],
    );
    expect(result.ok).toBe(false);
    expect(result.actual).toBe('0.2.0');
    expect(result.expected).toBe('0.1.0');
  });

  it('reports ok=false with actual="unknown" when output is unparseable', async () => {
    // Invoke a script that prints garbage
    const result = await checkBinaryVersion(
      process.execPath,
      '0.2.0',
      ['-e', "process.stdout.write('garbage')"],
    );
    expect(result.ok).toBe(false);
    expect(result.actual).toBe('unknown');
  });

  it('throws if the binary path is unspawnable', async () => {
    await expect(
      checkBinaryVersion('/definitely/does/not/exist/openplanet-lsp', '0.2.0'),
    ).rejects.toThrow();
  });

  it('returns ok=false when binary exits non-zero', async () => {
    const result = await checkBinaryVersion(
      process.execPath,
      '0.2.0',
      [fixtureBad],
    );
    expect(result.ok).toBe(false);
    expect(result.actual).toBe('unknown');
  });
});
```

Note: The third argument `extraArgs` lets tests pass a path-to-JS-fixture to `node`. Real production use calls `checkBinaryVersion(binaryPath, expected)` with no extraArgs, in which case `['--version']` is sent. See implementation below.

- [ ] **Step 3: Run tests — expect failure**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: FAIL — `checkBinaryVersion` not exported yet.

- [ ] **Step 4: Implement `checkBinaryVersion`**

Append to `src/version.ts`:
```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface VersionCheckResult {
  ok: boolean;
  actual: string;
  expected: string;
}

/**
 * Spawns `binaryPath --version` (or `binaryPath <extraArgs>` for testing)
 * and compares the parsed version to `expected`. Returns a structured result;
 * mismatch is ok=false, not thrown. Only spawn failures throw.
 */
export async function checkBinaryVersion(
  binaryPath: string,
  expected: string,
  extraArgs: readonly string[] = ['--version'],
): Promise<VersionCheckResult> {
  let stdout: string;
  try {
    const result = await execFileAsync(binaryPath, [...extraArgs], {
      timeout: 5_000,
      windowsHide: true,
    });
    stdout = result.stdout;
  } catch (err) {
    // Non-zero exit also lands here when using execFile with promisify.
    // Distinguish by whether the error is a spawn failure vs an exit.
    const e = err as NodeJS.ErrnoException & { code?: string | number };
    if (e.code === 'ENOENT' || e.code === 'EACCES') {
      throw err;
    }
    // Non-zero exit: return ok=false with unknown actual
    return { ok: false, actual: 'unknown', expected };
  }

  const actual = parseVersion(stdout) ?? 'unknown';
  return {
    ok: actual === expected,
    actual,
    expected,
  };
}
```

- [ ] **Step 5: Run tests — expect pass**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: all version tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/binary-resolver/src/version.ts packages/binary-resolver/tests/
git commit -m "Add checkBinaryVersion with fake-binary test fixtures"
```

---

## Task 12: `resolve.ts` — override source branch

**Files:**
- Create: `packages/binary-resolver/src/resolve.ts`
- Create: `packages/binary-resolver/tests/resolve.test.ts`

- [ ] **Step 1: Write failing tests for the override branch**

```ts
// tests/resolve.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBinary } from '../src/resolve.js';
import { BinaryNotFoundError } from '../src/errors.js';

describe('resolveBinary — override source', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'resolve-test-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns the override path when it exists', async () => {
    const bin = join(tmp, 'openplanet-lsp');
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);
    const result = await resolveBinary({ override: bin });
    expect(result.path).toBe(bin);
    expect(result.source).toBe('override');
  });

  it('throws BinaryNotFoundError when the override path is set but missing', async () => {
    const bin = join(tmp, 'missing-binary');
    await expect(resolveBinary({ override: bin })).rejects.toThrow(BinaryNotFoundError);
  });

  it('does not fall through to other sources when override is invalid', async () => {
    const bin = join(tmp, 'missing-binary');
    try {
      await resolveBinary({ override: bin });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BinaryNotFoundError);
      const e = err as BinaryNotFoundError;
      expect(e.checkedLocations).toHaveLength(1);
      expect(e.checkedLocations[0]?.source).toBe('override');
    }
  });

  it('invokes the log callback with the resolution source', async () => {
    const bin = join(tmp, 'openplanet-lsp');
    writeFileSync(bin, '');
    chmodSync(bin, 0o755);
    const logs: string[] = [];
    await resolveBinary({ override: bin, log: (m) => logs.push(m) });
    expect(logs.join('\n')).toContain('override');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: FAIL.

- [ ] **Step 3: Implement `resolve.ts` with only the override branch**

```ts
// src/resolve.ts
import { existsSync } from 'node:fs';
import type { ResolveOptions, ResolveResult } from './types.js';
import { BinaryNotFoundError, type CheckedLocation } from './errors.js';

export async function resolveBinary(opts: ResolveOptions): Promise<ResolveResult> {
  const log = opts.log ?? (() => {});
  const checked: CheckedLocation[] = [];

  // 1. Override
  if (opts.override !== undefined && opts.override !== '') {
    log(`trying override: ${opts.override}`);
    if (existsSync(opts.override)) {
      log(`resolved via override: ${opts.override}`);
      return { path: opts.override, source: 'override' };
    }
    checked.push({
      source: 'override',
      path: opts.override,
      reason: 'file not found (override is authoritative; not falling through)',
    });
    throw new BinaryNotFoundError({ checkedLocations: checked });
  }

  // Later branches added in subsequent tasks.
  throw new BinaryNotFoundError({ checkedLocations: checked });
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: override tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/binary-resolver/src/resolve.ts packages/binary-resolver/tests/resolve.test.ts
git commit -m "Add resolveBinary override branch with fail-fast semantics"
```

---

## Task 13: `resolve.ts` — `vscode-bundle` branch

**Files:**
- Modify: `packages/binary-resolver/src/resolve.ts`
- Modify: `packages/binary-resolver/tests/resolve.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('resolveBinary — vscode-bundle source', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'resolve-vscode-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves to <extensionPath>/bin/openplanet-lsp when present', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(tmp, 'bin'));
    const binName = process.platform === 'win32' ? 'openplanet-lsp.exe' : 'openplanet-lsp';
    const bin = join(tmp, 'bin', binName);
    writeFileSync(bin, '');
    chmodSync(bin, 0o755);
    const result = await resolveBinary({ extensionPath: tmp });
    expect(result.path).toBe(bin);
    expect(result.source).toBe('vscode-bundle');
  });

  it('falls through to later sources (or throws) when the vscode bin is missing', async () => {
    // No bin/ directory exists.
    await expect(resolveBinary({ extensionPath: tmp })).rejects.toThrow(BinaryNotFoundError);
  });

  it('records the vscode-bundle miss in checkedLocations', async () => {
    try {
      await resolveBinary({ extensionPath: tmp });
      throw new Error('should have thrown');
    } catch (err) {
      const e = err as BinaryNotFoundError;
      expect(e.checkedLocations.some((l) => l.source === 'vscode-bundle')).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: new `vscode-bundle` tests fail.

- [ ] **Step 3: Modify `resolve.ts` — add the `vscode-bundle` branch**

Replace the body of `resolveBinary` with:
```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolveOptions, ResolveResult } from './types.js';
import { BinaryNotFoundError, type CheckedLocation } from './errors.js';
import { getBinaryName } from './paths.js';

export async function resolveBinary(opts: ResolveOptions): Promise<ResolveResult> {
  const log = opts.log ?? (() => {});
  const checked: CheckedLocation[] = [];

  // 1. Override
  if (opts.override !== undefined && opts.override !== '') {
    log(`trying override: ${opts.override}`);
    if (existsSync(opts.override)) {
      log(`resolved via override: ${opts.override}`);
      return { path: opts.override, source: 'override' };
    }
    checked.push({
      source: 'override',
      path: opts.override,
      reason: 'file not found (override is authoritative; not falling through)',
    });
    throw new BinaryNotFoundError({ checkedLocations: checked });
  }

  // 2. VSCode bundle
  if (opts.extensionPath !== undefined && opts.extensionPath !== '') {
    const candidate = join(opts.extensionPath, 'bin', getBinaryName());
    log(`trying vscode-bundle: ${candidate}`);
    if (existsSync(candidate)) {
      log(`resolved via vscode-bundle: ${candidate}`);
      return { path: candidate, source: 'vscode-bundle' };
    }
    checked.push({
      source: 'vscode-bundle',
      path: candidate,
      reason: 'file not found under extensionPath/bin/',
    });
  }

  // Later branches added in subsequent tasks.
  throw new BinaryNotFoundError({ checkedLocations: checked });
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: all resolve tests so far pass.

- [ ] **Step 5: Commit**

```bash
git add packages/binary-resolver/src/resolve.ts packages/binary-resolver/tests/resolve.test.ts
git commit -m "Add vscode-bundle resolution branch with Windows .exe handling"
```

---

## Task 14: `resolve.ts` — `npm-platform-pkg` branch

**Files:**
- Modify: `packages/binary-resolver/src/resolve.ts`
- Modify: `packages/binary-resolver/tests/resolve.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('resolveBinary — npm-platform-pkg source', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'resolve-npm-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves to the binary inside a fake platform package', async () => {
    const { mkdirSync } = await import('node:fs');
    // Simulate a platform package at <tmp>/@openplanet-lsp/<platform-arch>/
    const { getPlatformArch, getBinaryName } = await import('../src/paths.js');
    const pkgDir = join(tmp, '@openplanet-lsp', getPlatformArch());
    mkdirSync(join(pkgDir, 'bin'), { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: `@openplanet-lsp/${getPlatformArch()}` }));
    const bin = join(pkgDir, 'bin', getBinaryName());
    writeFileSync(bin, '');
    chmodSync(bin, 0o755);

    // resolveFromPlatformPackage accepts a resolver shim in tests
    const result = await resolveBinary({
      _platformPackageResolver: () => join(pkgDir, 'package.json'),
    } as never);
    expect(result.path).toBe(bin);
    expect(result.source).toBe('npm-platform-pkg');
  });

  it('records a miss when the platform package is absent', async () => {
    try {
      await resolveBinary({
        _platformPackageResolver: () => {
          throw new Error('MODULE_NOT_FOUND');
        },
      } as never);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BinaryNotFoundError);
      const e = err as BinaryNotFoundError;
      expect(e.checkedLocations.some((l) => l.source === 'npm-platform-pkg')).toBe(true);
    }
  });
});
```

Design note: We introduce a private `_platformPackageResolver` option for testability. Production code uses `createRequire(import.meta.url).resolve(...)` under the hood; tests inject a fake. This is not exposed in the public `ResolveOptions` type — it's an internal hatch.

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: FAIL — new branch not implemented yet.

- [ ] **Step 3: Update `resolve.ts` — add the branch + test hatch**

Replace the function body and add an internal extended options type:

```ts
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { ResolveOptions, ResolveResult } from './types.js';
import { BinaryNotFoundError, type CheckedLocation } from './errors.js';
import { getBinaryName, getPlatformArch } from './paths.js';

type InternalResolveOptions = ResolveOptions & {
  /** @internal test hatch — accepts a fake resolver that returns the package.json path. */
  _platformPackageResolver?: (specifier: string) => string;
};

const defaultResolver = (specifier: string): string => {
  const requireFn = createRequire(import.meta.url);
  return requireFn.resolve(specifier);
};

export async function resolveBinary(
  opts: ResolveOptions | InternalResolveOptions,
): Promise<ResolveResult> {
  const internal = opts as InternalResolveOptions;
  const log = internal.log ?? (() => {});
  const checked: CheckedLocation[] = [];
  const resolver = internal._platformPackageResolver ?? defaultResolver;

  // 1. Override
  if (internal.override !== undefined && internal.override !== '') {
    log(`trying override: ${internal.override}`);
    if (existsSync(internal.override)) {
      log(`resolved via override: ${internal.override}`);
      return { path: internal.override, source: 'override' };
    }
    checked.push({
      source: 'override',
      path: internal.override,
      reason: 'file not found (override is authoritative; not falling through)',
    });
    throw new BinaryNotFoundError({ checkedLocations: checked });
  }

  // 2. VSCode bundle
  if (internal.extensionPath !== undefined && internal.extensionPath !== '') {
    const candidate = join(internal.extensionPath, 'bin', getBinaryName());
    log(`trying vscode-bundle: ${candidate}`);
    if (existsSync(candidate)) {
      log(`resolved via vscode-bundle: ${candidate}`);
      return { path: candidate, source: 'vscode-bundle' };
    }
    checked.push({
      source: 'vscode-bundle',
      path: candidate,
      reason: 'file not found under extensionPath/bin/',
    });
  }

  // 3. npm platform package
  const platformArch = safeGetPlatformArch();
  if (platformArch) {
    const specifier = `@openplanet-lsp/${platformArch}/package.json`;
    log(`trying npm-platform-pkg: ${specifier}`);
    try {
      const manifestPath = resolver(specifier);
      const pkgDir = dirname(manifestPath);
      const candidate = join(pkgDir, 'bin', getBinaryName());
      if (existsSync(candidate)) {
        log(`resolved via npm-platform-pkg: ${candidate}`);
        return { path: candidate, source: 'npm-platform-pkg' };
      }
      checked.push({
        source: 'npm-platform-pkg',
        path: candidate,
        reason: 'platform package manifest resolved but binary is missing under bin/',
      });
    } catch (err) {
      checked.push({
        source: 'npm-platform-pkg',
        path: specifier,
        reason: `module resolution failed: ${(err as Error).message}`,
      });
    }
  } else {
    checked.push({
      source: 'npm-platform-pkg',
      path: '(unknown platform/arch)',
      reason: 'unsupported host platform/arch combination',
    });
  }

  // Later branches added in the next task.
  throw new BinaryNotFoundError({ checkedLocations: checked });
}

function safeGetPlatformArch(): string | undefined {
  try {
    return getPlatformArch();
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: all resolve tests so far pass.

- [ ] **Step 5: Commit**

```bash
git add packages/binary-resolver/src/resolve.ts packages/binary-resolver/tests/resolve.test.ts
git commit -m "Add npm-platform-pkg resolution branch with injectable resolver"
```

---

## Task 15: `resolve.ts` — PATH fallback (opt-in) and final throw

**Files:**
- Modify: `packages/binary-resolver/src/resolve.ts`
- Modify: `packages/binary-resolver/tests/resolve.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('resolveBinary — PATH fallback', () => {
  let tmp: string;
  let originalPath: string | undefined;
  let originalAllowPath: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'resolve-path-'));
    originalPath = process.env.PATH;
    originalAllowPath = process.env.OPENPLANET_LSP_ALLOW_PATH;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    process.env.PATH = originalPath;
    if (originalAllowPath === undefined) delete process.env.OPENPLANET_LSP_ALLOW_PATH;
    else process.env.OPENPLANET_LSP_ALLOW_PATH = originalAllowPath;
  });

  it('does NOT search PATH when OPENPLANET_LSP_ALLOW_PATH is unset', async () => {
    delete process.env.OPENPLANET_LSP_ALLOW_PATH;
    // Plant a fake binary in tmp and put tmp on PATH.
    const { getBinaryName } = await import('../src/paths.js');
    const bin = join(tmp, getBinaryName());
    writeFileSync(bin, '');
    chmodSync(bin, 0o755);
    process.env.PATH = tmp;
    // With no override/extensionPath/platform pkg, the resolver should throw — not find this.
    await expect(
      resolveBinary({
        _platformPackageResolver: () => {
          throw new Error('MODULE_NOT_FOUND');
        },
      } as never),
    ).rejects.toThrow(BinaryNotFoundError);
  });

  it('searches PATH when OPENPLANET_LSP_ALLOW_PATH=1', async () => {
    process.env.OPENPLANET_LSP_ALLOW_PATH = '1';
    const { getBinaryName } = await import('../src/paths.js');
    const bin = join(tmp, getBinaryName());
    writeFileSync(bin, '');
    chmodSync(bin, 0o755);
    process.env.PATH = tmp;
    const result = await resolveBinary({
      _platformPackageResolver: () => {
        throw new Error('MODULE_NOT_FOUND');
      },
    } as never);
    expect(result.path).toBe(bin);
    expect(result.source).toBe('path');
  });

  it('lists every checked source in the BinaryNotFoundError when everything fails', async () => {
    delete process.env.OPENPLANET_LSP_ALLOW_PATH;
    try {
      await resolveBinary({
        extensionPath: tmp,
        _platformPackageResolver: () => {
          throw new Error('MODULE_NOT_FOUND');
        },
      } as never);
      throw new Error('should have thrown');
    } catch (err) {
      const e = err as BinaryNotFoundError;
      const sources = e.checkedLocations.map((l) => l.source);
      expect(sources).toContain('vscode-bundle');
      expect(sources).toContain('npm-platform-pkg');
      // PATH not in the list because it's disabled by default.
      expect(sources).not.toContain('path');
    }
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: FAIL — PATH branch not implemented.

- [ ] **Step 3: Add the PATH branch to `resolve.ts`**

Add at the top of the file:
```ts
import { delimiter } from 'node:path';
```

And append a PATH branch after the npm-platform-pkg branch (before the final `throw`):
```ts
  // 4. PATH fallback — opt-in only
  if (process.env.OPENPLANET_LSP_ALLOW_PATH === '1') {
    const binName = getBinaryName();
    const entries = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
    log(`trying path: searching ${entries.length} PATH entries for ${binName}`);
    for (const dir of entries) {
      const candidate = join(dir, binName);
      if (existsSync(candidate)) {
        log(`resolved via path: ${candidate}`);
        return { path: candidate, source: 'path' };
      }
    }
    checked.push({
      source: 'path',
      path: binName,
      reason: `not found in any of ${entries.length} PATH entries`,
    });
  }
```

- [ ] **Step 4: Run tests — expect pass**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: all resolve tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/binary-resolver/src/resolve.ts packages/binary-resolver/tests/resolve.test.ts
git commit -m "Add opt-in PATH fallback via OPENPLANET_LSP_ALLOW_PATH"
```

---

## Task 16: Public exports from `index.ts`

**Files:**
- Modify: `packages/binary-resolver/src/index.ts`
- Create: `packages/binary-resolver/tests/index.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/index.test.ts
import { describe, it, expect } from 'vitest';
import {
  resolveBinary,
  checkBinaryVersion,
  parseVersion,
  BinaryNotFoundError,
  getPlatformArch,
  getBinaryName,
} from '../src/index.js';
import type { ResolveOptions, ResolveResult, ResolveSource } from '../src/index.js';

describe('package index exports', () => {
  it('exports all public functions', () => {
    expect(typeof resolveBinary).toBe('function');
    expect(typeof checkBinaryVersion).toBe('function');
    expect(typeof parseVersion).toBe('function');
    expect(typeof getPlatformArch).toBe('function');
    expect(typeof getBinaryName).toBe('function');
  });

  it('exports BinaryNotFoundError as a constructable class', () => {
    const err = new BinaryNotFoundError({ checkedLocations: [] });
    expect(err).toBeInstanceOf(Error);
  });

  it('type imports compile (satisfies runtime check via void usage)', () => {
    const opts: ResolveOptions = { override: '/tmp/openplanet-lsp' };
    const result: Partial<ResolveResult> = { source: 'override' as ResolveSource };
    expect(opts.override).toBe('/tmp/openplanet-lsp');
    expect(result.source).toBe('override');
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run:
```bash
pnpm -F binary-resolver test
```
Expected: FAIL — imports not exported.

- [ ] **Step 3: Replace `src/index.ts` with public exports**

```ts
export { resolveBinary } from './resolve.js';
export { parseVersion, checkBinaryVersion } from './version.js';
export type { VersionCheckResult } from './version.js';
export { BinaryNotFoundError } from './errors.js';
export type { CheckedLocation } from './errors.js';
export { getPlatformArch, getBinaryName } from './paths.js';
export type { PlatformArch } from './paths.js';
export type { ResolveOptions, ResolveResult, ResolveSource } from './types.js';
```

- [ ] **Step 4: Run test — expect pass**

Run:
```bash
pnpm -F binary-resolver test
pnpm -F binary-resolver typecheck
```
Expected: both pass.

- [ ] **Step 5: Verify build produces dist/**

Run:
```bash
pnpm -F binary-resolver build
ls packages/binary-resolver/dist
```
Expected: `index.js`, `index.d.ts`, and files for each submodule.

- [ ] **Step 6: Commit**

```bash
git add packages/binary-resolver/src/index.ts packages/binary-resolver/tests/index.test.ts
git commit -m "Wire binary-resolver public exports from index.ts"
```

---

## Task 17: `verify-pkg-shape` script

**Files:**
- Create: `scripts/tsconfig.json`
- Create: `scripts/verify-pkg-shape.ts`
- Create: `scripts/tests/verify-pkg-shape.test.ts`

- [ ] **Step 1: Create `scripts/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 2: Write failing test**

```ts
// scripts/tests/verify-pkg-shape.test.ts
import { describe, it, expect } from 'vitest';
import { verifyPackageShape } from '../verify-pkg-shape.js';

describe('verifyPackageShape', () => {
  it('passes on a well-formed workspace package', () => {
    const pkg = {
      name: 'binary-resolver',
      version: '0.0.0',
      type: 'module',
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
      files: ['dist'],
      scripts: { test: 'vitest run', typecheck: 'tsc --noEmit' },
    };
    const result = verifyPackageShape(pkg, 'packages/binary-resolver/package.json');
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports missing required fields', () => {
    const pkg = { name: 'foo' };
    const result = verifyPackageShape(pkg, 'packages/foo/package.json');
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/version/);
    expect(result.errors.join('\n')).toMatch(/scripts\.test/);
    expect(result.errors.join('\n')).toMatch(/scripts\.typecheck/);
  });

  it('reports when "type" is not "module"', () => {
    const pkg = {
      name: 'foo',
      version: '0.0.0',
      type: 'commonjs',
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
      files: ['dist'],
      scripts: { test: 'vitest run', typecheck: 'tsc --noEmit' },
    };
    const result = verifyPackageShape(pkg, 'packages/foo/package.json');
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/type.*module/);
  });
});
```

- [ ] **Step 3: Run test — expect failure**

Run:
```bash
pnpm exec vitest run scripts/tests/verify-pkg-shape.test.ts
```
Expected: FAIL.

- [ ] **Step 4: Implement `scripts/verify-pkg-shape.ts`**

```ts
// scripts/verify-pkg-shape.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export interface ShapeResult {
  ok: boolean;
  errors: string[];
}

const REQUIRED_FIELDS = ['name', 'version', 'type', 'main', 'types', 'files', 'scripts'] as const;
const REQUIRED_SCRIPTS = ['test', 'typecheck'] as const;

export function verifyPackageShape(pkg: unknown, path: string): ShapeResult {
  const errors: string[] = [];
  if (typeof pkg !== 'object' || pkg === null) {
    return { ok: false, errors: [`${path}: not a JSON object`] };
  }
  const p = pkg as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (!(field in p)) {
      errors.push(`${path}: missing required field "${field}"`);
    }
  }

  if ('type' in p && p.type !== 'module') {
    errors.push(`${path}: "type" must be "module" (got ${JSON.stringify(p.type)})`);
  }

  const scripts = (p.scripts ?? {}) as Record<string, unknown>;
  for (const s of REQUIRED_SCRIPTS) {
    if (typeof scripts[s] !== 'string') {
      errors.push(`${path}: missing required script "scripts.${s}"`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function main(): void {
  const packagesDir = 'packages';
  let entries: string[];
  try {
    entries = readdirSync(packagesDir);
  } catch {
    console.log('no packages/ directory; nothing to verify');
    return;
  }

  let failed = false;
  for (const entry of entries) {
    const pkgPath = join(packagesDir, entry, 'package.json');
    let stat;
    try {
      stat = statSync(pkgPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const raw = readFileSync(pkgPath, 'utf8');
    const pkg: unknown = JSON.parse(raw);
    const result = verifyPackageShape(pkg, pkgPath);
    if (!result.ok) {
      failed = true;
      for (const err of result.errors) {
        console.error(`❌ ${err}`);
      }
    } else {
      console.log(`✅ ${pkgPath}`);
    }
  }
  if (failed) process.exit(1);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
```

- [ ] **Step 5: Run tests — expect pass**

Run:
```bash
pnpm exec vitest run scripts/tests/verify-pkg-shape.test.ts
```
Expected: all tests pass.

- [ ] **Step 6: Run the script against the real workspace**

Run:
```bash
pnpm exec tsx scripts/verify-pkg-shape.ts
```
Expected: `✅ packages/binary-resolver/package.json`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/tsconfig.json scripts/verify-pkg-shape.ts scripts/tests/verify-pkg-shape.test.ts
git commit -m "Add verify-pkg-shape script with unit tests"
```

---

## Task 18: `ci.yml` — the real PR check workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    name: Lint + Format
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format:check

  typecheck:
    name: Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  unit:
    name: Unit Tests
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  pkg-shape:
    name: Package Shape
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec tsx scripts/verify-pkg-shape.ts

  ci-parity:
    name: CI ↔ justfile Parity
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec tsx scripts/verify-ci-parity.ts
```

Note: the `ci-parity` job references `scripts/verify-ci-parity.ts`, which is created in Task 19. Until then, pushing this commit would cause the `ci-parity` job to fail on GitHub. That's acceptable: Task 19 follows immediately, and nothing is pushed to a remote until Task 24.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Add ci.yml with lint/typecheck/unit/pkg-shape/ci-parity jobs"
```

---

## Task 19: `verify-ci-parity` script + wire `just ci`

**Files:**
- Create: `scripts/verify-ci-parity.ts`
- Create: `scripts/tests/verify-ci-parity.test.ts`
- Modify: `justfile`

The meta-test: assert that `just ci` and `ci.yml` invoke the same commands. The contract is a hand-maintained mapping; the script parses both files and fails on drift.

- [ ] **Step 1: Write failing test**

```ts
// scripts/tests/verify-ci-parity.test.ts
import { describe, it, expect } from 'vitest';
import { extractCiCommands, extractJustCiCommands, compareCommandSets } from '../verify-ci-parity.js';

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
```

- [ ] **Step 2: Run tests — expect failure**

Run:
```bash
pnpm exec vitest run scripts/tests/verify-ci-parity.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `scripts/verify-ci-parity.ts`**

```ts
// scripts/verify-ci-parity.ts
import { readFileSync } from 'node:fs';
import process from 'node:process';

const EXCLUDED = new Set([
  'pnpm install --frozen-lockfile',
  'pnpm install',
]);

/**
 * Extracts `run:` values from a GitHub Actions workflow YAML.
 * Returns a set of distinct shell commands. Intentionally primitive — we
 * match `- run: <command>` and `run: <command>` lines, which is enough for
 * the shape our workflows take. If we ever start using `|` multiline runs
 * this parser needs to grow; for now, single-line `run:` is the rule.
 */
export function extractCiCommands(yaml: string): Set<string> {
  const cmds = new Set<string>();
  const lineRegex = /^\s*-?\s*run:\s*(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(yaml)) !== null) {
    let cmd = match[1]!.trim();
    // Strip surrounding quotes if present.
    if (
      (cmd.startsWith('"') && cmd.endsWith('"')) ||
      (cmd.startsWith("'") && cmd.endsWith("'"))
    ) {
      cmd = cmd.slice(1, -1);
    }
    if (EXCLUDED.has(cmd)) continue;
    cmds.add(cmd);
  }
  return cmds;
}

/**
 * Extracts the shell commands invoked by the `ci:` recipe in a justfile.
 * We follow one level of dependency: the `ci:` recipe lists sub-recipes, and
 * each sub-recipe has its own command lines. We parse both.
 */
export function extractJustCiCommands(just: string): Set<string> {
  const lines = just.split(/\r?\n/);
  const recipes = new Map<string, string[]>();
  let currentRecipe: string | null = null;

  for (const raw of lines) {
    // Recipe header: name followed by `:` and optional deps
    const header = /^([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*([^#]*?)\s*$/.exec(raw);
    if (header && !raw.startsWith(' ') && !raw.startsWith('\t')) {
      currentRecipe = header[1]!;
      // Deps listed after the colon become part of the body graph
      const deps = (header[2] ?? '').trim().split(/\s+/).filter(Boolean);
      recipes.set(currentRecipe, deps.length > 0 ? [`__deps__:${deps.join(',')}`] : []);
      continue;
    }
    if (currentRecipe && /^(    |\t)/.test(raw)) {
      const body = raw.replace(/^(    |\t)/, '').trim();
      if (body && !body.startsWith('#')) {
        recipes.get(currentRecipe)!.push(body);
      }
    }
  }

  const cmds = new Set<string>();
  const visited = new Set<string>();

  function walk(recipe: string): void {
    if (visited.has(recipe)) return;
    visited.add(recipe);
    const body = recipes.get(recipe) ?? [];
    for (const line of body) {
      if (line.startsWith('__deps__:')) {
        const deps = line.slice('__deps__:'.length).split(',').filter(Boolean);
        for (const d of deps) walk(d);
        continue;
      }
      if (line.startsWith('@')) {
        cmds.add(line.slice(1));
      } else {
        cmds.add(line);
      }
    }
  }

  walk('ci');
  return cmds;
}

export interface CompareResult {
  ok: boolean;
  missing: string[]; // in ci.yml, absent from just ci
}

export function compareCommandSets(
  ciCmds: Set<string>,
  justCmds: Set<string>,
): CompareResult {
  const missing: string[] = [];
  for (const c of ciCmds) {
    if (!justCmds.has(c)) missing.push(c);
  }
  return { ok: missing.length === 0, missing };
}

function main(): void {
  const ciYaml = readFileSync('.github/workflows/ci.yml', 'utf8');
  const justfile = readFileSync('justfile', 'utf8');
  const ciCmds = extractCiCommands(ciYaml);
  const justCmds = extractJustCiCommands(justfile);
  const result = compareCommandSets(ciCmds, justCmds);
  if (!result.ok) {
    console.error('❌ ci.yml contains commands that are not invoked by `just ci`:');
    for (const m of result.missing) console.error(`  - ${m}`);
    console.error('\nEither add them to the justfile ci recipe (or a sub-recipe it calls),');
    console.error('or remove them from ci.yml. Parity is enforced to prevent drift.');
    process.exit(1);
  }
  console.log(`✅ just ci covers all ${ciCmds.size} ci.yml commands`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
```

- [ ] **Step 4: Run tests — expect pass**

Run:
```bash
pnpm exec vitest run scripts/tests/verify-ci-parity.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Wire up the `ci` recipe in `justfile`**

Append to `justfile`:
```makefile

# ─── CI mirror ────────────────────────────────────────────────────────────
verify-pkg-shape:
    pnpm exec tsx scripts/verify-pkg-shape.ts

verify-ci-parity:
    pnpm exec tsx scripts/verify-ci-parity.ts

ci: lint format-check typecheck test verify-pkg-shape verify-ci-parity
```

- [ ] **Step 6: Run `just ci` end-to-end**

Run:
```bash
just ci
```
Expected: all sub-recipes run; exit 0. If `verify-ci-parity` reports missing commands, add them to the justfile ci chain.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-ci-parity.ts scripts/tests/verify-ci-parity.test.ts justfile
git commit -m "Add verify-ci-parity script and wire just ci to mirror ci.yml"
```

---

## Task 20: Remaining workflow files (stubs)

**Files:**
- Create: `.github/workflows/integration.yml`
- Create: `.github/workflows/build-binaries.yml`
- Create: `.github/workflows/release.yml`
- Create: `.github/workflows/publish-npm.yml`
- Create: `.github/workflows/publish-vsce.yml`
- Create: `.github/workflows/publish-ovsx.yml`
- Create: `.github/workflows/nightly.yml`
- Create: `.github/workflows/codeql.yml`

These land as parsable, runnable (but mostly no-op) workflow files so the repo is ready to flip each one on in a later milestone.

- [ ] **Step 1: Create `.github/workflows/integration.yml`**

```yaml
name: Integration

# Opt-in: only runs on PRs explicitly labeled 'integration' or on pushes to main.
# This keeps the common PR path fast while letting maintainers force a full run.
on:
  pull_request:
    types: [labeled, synchronize, opened, reopened]
  push:
    branches: [main]

jobs:
  gate:
    name: Integration Gate
    runs-on: ubuntu-latest
    # Only run body steps if push-to-main OR PR has the 'integration' label.
    if: >
      github.event_name == 'push' ||
      (github.event_name == 'pull_request' &&
       contains(github.event.pull_request.labels.*.name, 'integration'))
    steps:
      - uses: actions/checkout@v4
      - name: Placeholder
        run: echo "Integration test suite not yet implemented — lands in M3/M4."
```

- [ ] **Step 2: Create `.github/workflows/build-binaries.yml`**

```yaml
name: Build Binaries

# Reusable workflow: called by integration.yml and release.yml once those
# actually need to build the Rust binary. Not yet wired up.
on:
  workflow_call:
    inputs:
      ref:
        description: 'openplanet-lsp git ref to build'
        required: false
        type: string
        default: ''

jobs:
  placeholder:
    name: Placeholder
    runs-on: ubuntu-latest
    steps:
      - run: echo "Binary build pipeline lands in M2/M3."
      - run: echo "Will read BINARY_REF, clone openplanet-lsp, cargo build --release --target X."
```

- [ ] **Step 3: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  placeholder:
    name: Release Placeholder
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "Release pipeline lands in M8."
      - run: echo "Will validate tag, build binaries, stage platform packages, create GitHub Release,"
      - run: echo "then fan out to publish-npm / publish-vsce / publish-ovsx gated on secrets."
```

- [ ] **Step 4: Create `.github/workflows/publish-npm.yml`**

```yaml
name: Publish npm

on:
  workflow_call:
    secrets:
      NPM_TOKEN:
        required: true

jobs:
  gate:
    name: Publish Gate
    runs-on: ubuntu-latest
    environment: npm
    steps:
      - run: |
          if [ -z "${{ secrets.NPM_TOKEN }}" ]; then
            echo "::notice::NPM_TOKEN not configured; skipping publish."
            exit 0
          fi
          echo "publish-npm pipeline lands in M8."
```

- [ ] **Step 5: Create `.github/workflows/publish-vsce.yml`**

```yaml
name: Publish VSCE

on:
  workflow_call:
    secrets:
      VSCE_PAT:
        required: true

jobs:
  gate:
    name: Publish Gate
    runs-on: ubuntu-latest
    environment: vsce
    steps:
      - run: |
          if [ -z "${{ secrets.VSCE_PAT }}" ]; then
            echo "::notice::VSCE_PAT not configured; skipping publish."
            exit 0
          fi
          echo "publish-vsce pipeline lands in M8."
```

- [ ] **Step 6: Create `.github/workflows/publish-ovsx.yml`**

```yaml
name: Publish Open VSX

on:
  workflow_call:
    secrets:
      OVSX_PAT:
        required: true

jobs:
  gate:
    name: Publish Gate
    runs-on: ubuntu-latest
    environment: ovsx
    steps:
      - run: |
          if [ -z "${{ secrets.OVSX_PAT }}" ]; then
            echo "::notice::OVSX_PAT not configured; skipping publish."
            exit 0
          fi
          echo "publish-ovsx pipeline lands in M8."
```

- [ ] **Step 7: Create `.github/workflows/nightly.yml`**

```yaml
name: Nightly

# Disabled by default — enable in M8 by removing `if: false` and setting a schedule.
on:
  schedule:
    - cron: '0 6 * * *'
  workflow_dispatch:

jobs:
  nightly:
    name: Nightly Build
    runs-on: ubuntu-latest
    if: false
    steps:
      - uses: actions/checkout@v4
      - run: echo "Nightly build against openplanet-lsp@main lands in M8."
```

- [ ] **Step 8: Create `.github/workflows/codeql.yml`**

```yaml
name: CodeQL

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 12 * * 1'

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@v3
```

- [ ] **Step 9: Commit**

```bash
git add .github/workflows/integration.yml .github/workflows/build-binaries.yml .github/workflows/release.yml .github/workflows/publish-npm.yml .github/workflows/publish-vsce.yml .github/workflows/publish-ovsx.yml .github/workflows/nightly.yml .github/workflows/codeql.yml
git commit -m "Add stub workflows: integration, build-binaries, release, publish-*, nightly, codeql"
```

---

## Task 21: Repository documentation — README, CHANGELOG, CONTRIBUTING, docs scaffolding

**Files:**
- Create: `README.md`
- Create: `CHANGELOG.md`
- Create: `CONTRIBUTING.md`
- Create: `docs/editor-setup/.gitkeep`
- Create: `docs/internal/.gitkeep`

- [ ] **Step 1: Create `README.md`**

```markdown
# lsp-openplanet-ext

VSCode extension and npm package that wrap [`openplanet-lsp`](https://github.com/clankercode/lsp-openplanet) — a language server for OpenPlanet AngelScript plugins — so you can use it from any editor or agentic CLI without needing a Rust toolchain.

## Status

Under development. First milestone (M1 — Foundation) produces the monorepo skeleton, the shared `binary-resolver` package, and a complete CI pipeline. See `docs/superpowers/plans/` for milestone plans.

## Packages

| Package | Purpose | Status |
|---|---|---|
| `packages/binary-resolver` | Shared binary-path resolution logic | M1 |
| `packages/npm-lsp` | `openplanet-lsp` npm CLI + platform packages | M2/M3 |
| `packages/vscode-ext` | VSCode extension (`openplanet-lsp-vscode`) | M4/M6 |
| `packages/grammar` | AngelScript TextMate grammar | M5 |

## Local development

```bash
pnpm install
just ci
```

See `CONTRIBUTING.md` for the full dev workflow and `just --list` for available commands.

## License

[UNLICENSE](./LICENSE) — public domain.
```

- [ ] **Step 2: Create `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Monorepo skeleton: pnpm workspace, TypeScript base config, ESLint flat config, Prettier, justfile.
- `binary-resolver` package with full TDD coverage: platform detection, version parsing, binary version handshake, and four-source resolution (override, vscode-bundle, npm-platform-pkg, opt-in PATH).
- Complete CI workflow files: `ci.yml` (lint, typecheck, unit, pkg-shape, ci-parity), plus stubs for integration, build-binaries, release, publish-npm, publish-vsce, publish-ovsx, nightly, codeql.
- `verify-ci-parity.ts` meta-test enforcing that `just ci` and `ci.yml` invoke the same command set.
```

- [ ] **Step 3: Create `CONTRIBUTING.md`**

```markdown
# Contributing

Thanks for your interest in contributing! This project is in early development and welcomes improvements via PRs.

## Prerequisites

- Node.js ≥20
- pnpm 9 (`npm i -g pnpm@9` if you don't have it)
- `just` task runner ([installation](https://github.com/casey/just))
- Optional: `nektos/act` for local GitHub Actions workflow debugging

## Getting started

```bash
pnpm install
just ci
```

`just ci` runs the complete PR check locally: lint, Prettier check, typecheck, unit tests, package shape validation, and the `ci.yml` parity check.

## Workflow

1. Branch from `main`.
2. Make your change.
3. Test-Driven Development is the expectation for any non-trivial code change: write a failing test first, then the implementation.
4. Run `just ci` locally before pushing.
5. Open a PR. The CI workflow will run the same checks on ubuntu/macOS/Windows.

## Local vs CI parity

`scripts/verify-ci-parity.ts` enforces that every command in `.github/workflows/ci.yml` is also invoked by `just ci` (directly or via one of its sub-recipes). If you add a new check to one, add it to the other. Drift between local and CI is a bug the parity check catches immediately.

## Just targets

Run `just --list` for a full catalog. Key targets:

- `just install` — install all dependencies
- `just ci` — run the complete local CI check
- `just test` — unit tests across all packages
- `just lint` — ESLint across the workspace
- `just typecheck` — TypeScript check across all packages
- `just clean` — wipe `node_modules`, `dist`, `.cache`

## License

By contributing, you agree that your contributions will be released into the public domain under the UNLICENSE.
```

- [ ] **Step 4: Create docs directory placeholders**

```bash
mkdir -p docs/editor-setup docs/internal
touch docs/editor-setup/.gitkeep docs/internal/.gitkeep
```

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md CONTRIBUTING.md docs/editor-setup/.gitkeep docs/internal/.gitkeep
git commit -m "Add README, CHANGELOG, CONTRIBUTING, and docs directory scaffolds"
```

---

## Task 22: Final verification — `just ci` green

**Files:** (none modified — verification only)

- [ ] **Step 1: Clean slate**

Run:
```bash
just clean
pnpm install
```
Expected: clean install completes without errors.

- [ ] **Step 2: Typecheck**

Run:
```bash
just typecheck
```
Expected: exit 0, no TypeScript errors.

- [ ] **Step 3: Test**

Run:
```bash
just test
```
Expected: exit 0, all binary-resolver tests pass.

- [ ] **Step 4: Lint**

Run:
```bash
just lint
just format-check
```
Expected: both exit 0.

- [ ] **Step 5: Package shape**

Run:
```bash
just verify-pkg-shape
```
Expected: `✅ packages/binary-resolver/package.json`, exit 0.

- [ ] **Step 6: CI parity**

Run:
```bash
just verify-ci-parity
```
Expected: `✅ just ci covers all N ci.yml commands`, exit 0.

- [ ] **Step 7: Full `just ci`**

Run:
```bash
just ci
```
Expected: every sub-recipe runs successfully; overall exit 0.

- [ ] **Step 8: Verify git state is clean**

Run:
```bash
git status
```
Expected: "working tree clean".

- [ ] **Step 9: Optional — validate `ci.yml` with `act`**

If `act` is installed locally:
```bash
act -j lint
```
Expected: the `lint` job runs in Docker and passes. (If `act` is not installed, skip this step — it will be covered by the first real GitHub Actions run after pushing.)

- [ ] **Step 10: Push to remote and verify Actions run**

Assuming the repo is pushed to a GitHub remote:
```bash
git push origin master
```
Then open the repo on GitHub, find the triggered `CI` workflow run, and verify every job reports green.

If the remote is not yet configured, or the user would rather verify locally first, skip this step and communicate the M1 exit status without remote CI confirmation.

- [ ] **Step 11: No new commit needed**

If steps 1–10 all pass without requiring fixes, no commit is needed. If any step turned up an issue and you corrected it inline, commit the fix with a descriptive message like:
```bash
git commit -am "Fix: <specific issue from Step N>"
```

---

## Self-Review Checklist (run after writing; not a task)

**Spec coverage (M1 sections of the design):**
- ✅ §1 acceptance criteria 9 ("CI runs end-to-end without secrets") → Task 18 + Task 20
- ✅ §1 acceptance criterion 10 (`just pre-release-check` — stubbed to land in M8; not M1)
- ✅ §2 repo layout → Tasks 1, 2, 6, 20, 21
- ✅ §2 "packages/binary-resolver" fully realized → Tasks 6–16
- ✅ §3 binary-resolver public interface → Task 16 (`index.ts` exports)
- ✅ §3 resolution order → Tasks 12–15 (override → vscode-bundle → npm-platform-pkg → PATH)
- ✅ §3 `OPENPLANET_LSP_ALLOW_PATH` opt-in → Task 15
- ✅ §3 version parsing (`--version` output format) → Tasks 10, 11
- ✅ §7 ci.yml jobs (lint, typecheck, unit matrix, pkg-shape, verify-ci-parity) → Task 18
- ✅ §7 publish workflow stubs gated on secrets → Task 20
- ✅ §7 release.yml / build-binaries.yml / nightly.yml / codeql.yml stubs → Task 20
- ✅ §9 justfile targets (install, build, test, lint, typecheck, clean, ci) → Tasks 5, 19
- ✅ §9 verify-ci-parity.ts meta-test → Task 19
- ✅ §9 verify-pkg-shape.ts → Task 17

**Placeholder scan:** No "TBD", "fill in later", or bare-description steps. Every code step has complete code.

**Type consistency:**
- `ResolveSource`, `ResolveOptions`, `ResolveResult` defined once in `types.ts` (Task 9), imported consistently in `errors.ts` (Task 8), `resolve.ts` (Tasks 12–15), and re-exported from `index.ts` (Task 16).
- `CheckedLocation` defined in `errors.ts` (Task 8), used in `resolve.ts` (Tasks 12–15).
- `getBinaryName()` / `getPlatformArch()` defined in `paths.ts` (Task 7), used in `resolve.ts` (Tasks 13, 14).
- `parseVersion` / `checkBinaryVersion` / `VersionCheckResult` defined in `version.ts` (Tasks 10, 11), exported from `index.ts` (Task 16).

**Deferred to later milestones (intentionally):**
- `packages/npm-lsp`, `packages/vscode-ext`, `packages/grammar` — M2+
- `build-binaries.yml` real implementation — M3
- `release.yml` real implementation — M8
- `pre-release-check` recipe — M8
- Editor setup docs, upstreaming playbook, release checklist — M7/M8
- `fetch-openplanet-lsp.ts`, `stage-platform-package.ts`, `stage-vsce-bin.ts`, `smoke-nvim.ts` — M2+ as needed

Exit M1 with a green `just ci` locally and on GitHub Actions, and the repo is ready for M2 (first-platform npm package build).
