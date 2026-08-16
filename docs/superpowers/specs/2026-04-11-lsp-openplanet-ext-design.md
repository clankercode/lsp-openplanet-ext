# lsp-openplanet-ext — Design Specification

**Status:** approved  
**Date:** 2026-04-11  
**Author:** Max Kaye (via brainstorming session)  
**Binary target:** `openplanet-lsp v0.2.0` (commit `4a916fd`, tag `v0.2.0` at `git@github.com:clankercode/lsp-openplanet.git`)

---

## Table of Contents

1. [Goals, Non-Goals, Acceptance Criteria](#1-goals-non-goals-acceptance-criteria)
2. [Repo Layout](#2-repo-layout)
3. [Shared `binary-resolver` Package](#3-shared-binary-resolver-package)
4. [`openplanet-lsp` npm Package](#4-openplanet-lsp-npm-package)
5. [`openplanet-lsp-vscode` Extension](#5-openplanet-lsp-vscode-extension)
6. [TextMate Grammar + Automated Grammar Tests](#6-textmate-grammar--automated-grammar-tests)
7. [CI / Release Pipeline](#7-ci--release-pipeline)
8. [Editor Documentation + Internal Upstream Playbook](#8-editor-documentation--internal-upstream-playbook)
9. [`justfile`, Dev Scripts, Local CI Validation](#9-justfile-dev-scripts-local-ci-validation)
10. [Consolidated Test Strategy](#10-consolidated-test-strategy)
11. [Assumptions, Open Questions, Risks, v1 Milestone Plan](#11-assumptions-open-questions-risks-v1-milestone-plan)

---

## 1. Goals, Non-Goals, Acceptance Criteria

### Goal

Make `openplanet-lsp` (the Rust language server in `../lsp-openplanet`) usable by every editor
and agentic CLI an OpenPlanet plugin developer might reach for, without requiring any of them to
have a Rust toolchain.

### In Scope (v1)

- A VSCode extension that activates on `*.as` files and `info.toml`, spawns the bundled
  `openplanet-lsp` binary, surfaces logs/status/settings, exposes a "regenerate type DB cache"
  command, and ships syntax highlighting for AngelScript.
- An npm package `openplanet-lsp` that exposes a single bin which execs the bundled binary as a
  stdio LSP, plus helper flags for diagnostics.
- Documentation for configuring nvim (`nvim-lspconfig`), Sublime (LSP package), opencode, and
  claude-code to use the npm package.
- An internal future-work playbook covering upstream contributions to nvim-lspconfig + Mason and
  submission to Sublime Package Control — written down, not executed.
- Automated tests for the TextMate grammar so it can be improved autonomously.
- A comprehensive CI workflow (including secret-gated publish jobs landed as disabled stubs ready
  to flip on once API keys are configured).
- A `justfile` with all common development, testing, and release commands.
- Scripts to validate the CI workflow locally.

### Out of Scope (v1)

- Any change to `openplanet-lsp` itself (changes were coordinated separately; v0.2.0 is the
  target).
- Auto-update of the binary outside a wrapper release.
- Plugin scaffolding wizards, snippet libraries, debugger integration.
- Telemetry of any kind.
- Web-based playground.
- Upstream PRs (nvim-lspconfig, Mason registry, Sublime Package Control) — internal playbook
  only.

### Acceptance Criteria

1. `code --install-extension openplanet-lsp-vscode-<version>-linux-x64.vsix` produces a working
   LSP experience on a fresh VSCode install with no other dependencies.
2. Same for darwin-x64, darwin-arm64, linux-arm64, win32-x64, win32-arm64.
3. `npm install -g openplanet-lsp && openplanet-lsp --check` reports a healthy bundled binary on
   all six platforms.
4. A documented nvim config snippet produces working diagnostics and completion against a real
   OpenPlanet plugin.
5. A documented Sublime LSP config snippet does the same.
6. A documented opencode config and a documented claude-code config each successfully invoke the
   LSP.
7. The TextMate grammar test suite runs in CI and fails on intentional regressions.
8. `--server-path /path/to/locally-built/openplanet-lsp` works in both the extension (via
   setting) and the npm CLI.
9. CI runs end-to-end (lint, typecheck, unit tests, grammar tests, integration smoke) without any
   secrets configured — publish jobs are wired but skipped cleanly.
10. `just pre-release-check` exits 0 before tagging a release.

### License

UNLICENSE (public domain). All packages in this repo use the same license.

---

## 2. Repo Layout

**Workspace tool:** pnpm workspaces.  
**Grammar authoring:** YAML, compiled to JSON by a build step.  
**Binary source:** fetched from `../lsp-openplanet` at tag `BINARY_REF` by CI and dev scripts; never committed.

```
lsp-openplanet-ext/
├── package.json                        # workspace root, dev tooling only
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── justfile
├── BINARY_REF                          # contains the openplanet-lsp git tag, e.g. "v0.2.0"
├── LICENSE                             # UNLICENSE
├── README.md
├── CHANGELOG.md                        # Keep-a-Changelog format
├── CONTRIBUTING.md
├── .github/workflows/
│   ├── ci.yml
│   ├── integration.yml
│   ├── build-binaries.yml              # reusable workflow
│   ├── release.yml
│   ├── publish-npm.yml                 # gated on NPM_TOKEN
│   ├── publish-vsce.yml                # gated on VSCE_PAT
│   ├── publish-ovsx.yml                # gated on OVSX_PAT
│   ├── nightly.yml                     # disabled by default (if: false)
│   └── codeql.yml
├── docs/
│   ├── superpowers/specs/              # this document lives here
│   ├── editor-setup/
│   │   ├── nvim.md
│   │   ├── sublime.md
│   │   ├── opencode.md
│   │   └── claude-code.md
│   └── internal/
│       ├── upstreaming-playbook.md
│       ├── ci-runbook.md
│       ├── release-checklist.md
│       ├── local-dev.md
│       ├── update-corpus-prompt.md
│       └── manual-sublime-verification.md  # fallback if headless Sublime testing is impractical
├── packages/
│   ├── binary-resolver/
│   │   ├── src/index.ts
│   │   ├── tests/
│   │   └── package.json
│   ├── npm-lsp/
│   │   ├── src/cli.ts
│   │   ├── bin/openplanet-lsp          # shim that requires src/cli
│   │   ├── tests/
│   │   └── package.json                # declares 6 optionalDependencies
│   ├── npm-lsp-platforms/
│   │   ├── linux-x64/
│   │   │   └── package.json            # os/cpu constrained; bin/ populated by CI
│   │   ├── linux-arm64/
│   │   ├── darwin-x64/
│   │   ├── darwin-arm64/
│   │   ├── win32-x64/
│   │   └── win32-arm64/
│   ├── vscode-ext/
│   │   ├── src/extension.ts
│   │   ├── bin/                        # populated by CI before vsce package; not committed
│   │   ├── syntaxes/
│   │   │   └── angelscript.tmLanguage.json   # generated from grammar package; committed
│   │   ├── language-configuration.json
│   │   ├── tests/
│   │   └── package.json
│   └── grammar/
│       ├── src/
│       │   └── angelscript.tmLanguage.yaml   # authoritative grammar source
│       ├── tests/
│       │   ├── fixtures/               # annotated *.as micro-fixture files
│       │   ├── corpus/                 # 50+ real plugin files for snapshot tests (10c: inline)
│       │   └── negative/               # malformed files; assert no tokenization crash
│       ├── build.ts                    # YAML → JSON, copy into vscode-ext/syntaxes/
│       └── package.json
└── scripts/
    ├── fetch-openplanet-lsp.ts         # clone lsp-openplanet at BINARY_REF, cargo build
    ├── stage-platform-package.ts       # populate npm-lsp-platforms/<target>/bin/
    ├── stage-vsce-bin.ts               # populate vscode-ext/bin/
    ├── verify-ci-parity.ts             # assert just ci ≡ ci.yml steps
    ├── verify-grammar-sync.ts          # rebuild grammar, fail if JSON drifted
    ├── bump-version.ts                 # update all package.jsons + BINARY_REF, commit
    ├── health-check.ts                 # resolution source table for just check-binary
    ├── smoke-nvim.ts                   # headless nvim LSP smoke test
    └── smoke-sublime.ts                # headless Sublime test (may fall back to manual)
```

**Why pnpm:** strict by default (packages only see declared deps), `workspace:*` protocol, fast
install, lockfile-friendly, compatible with `vsce` and `npm publish`.

**Grammar authoring in YAML:** TextMate regexes contain backslashes, brackets, and quotes
throughout — JSON makes them unreadable. YAML allows comments, which document why complex regexes
look the way they do. The compiled JSON is committed so VSIX builds work without running TS.
`verify-grammar-sync.ts` catches YAML/JSON drift in CI.

**Platform packages `bin/` not committed:** The `packages/npm-lsp-platforms/<target>/bin/`
directories contain platform-specific binaries dropped in by CI at release time.
`scripts/fetch-openplanet-lsp.ts` handles local development.

---

## 3. Shared `binary-resolver` Package

Both `npm-lsp` and `vscode-ext` import this package. It owns the single answer to "where is the
`openplanet-lsp` executable on this machine right now?"

### Public Interface

```ts
export type ResolveOptions = {
  // Explicit override; wins over everything if provided and the file exists.
  // From --server-path (CLI) or openplanetLsp.serverPath (VSCode setting).
  override?: string;

  // For VSCode: path to extension's install dir, containing bin/openplanet-lsp[.exe].
  // For npm: not used; resolution goes through require.resolve of the optional platform package.
  extensionPath?: string;

  // Logger so callers can see why a particular path was chosen.
  log?: (msg: string) => void;
};

export type ResolveResult = {
  path: string;          // absolute path to the binary, verified to exist
  source: ResolveSource; // where it came from
  version?: string;      // result of parsing `<bin> --version` output
};

export type ResolveSource =
  | "override"           // explicit user override
  | "vscode-bundle"      // shipped inside platform-specific VSIX
  | "npm-platform-pkg"   // resolved via optional dep
  | "path"               // found on $PATH (opt-in via OPENPLANET_LSP_ALLOW_PATH=1 only)
  ;

export async function resolveBinary(opts: ResolveOptions): Promise<ResolveResult>;
export class BinaryNotFoundError extends Error { /* structured; lists every location checked */ }
```

### Resolution Order

1. **Override** — if `opts.override` is set, verify the file exists and return immediately.
   If the override path is set but missing, throw `BinaryNotFoundError` — do NOT fall through.
   Silently falling through would ignore a user's explicit configuration.
2. **VSCode bundle** — if `opts.extensionPath` is set, look for
   `<extensionPath>/bin/openplanet-lsp[.exe]`. Return with `source: "vscode-bundle"`.
3. **npm platform package** — `require.resolve('@openplanet-lsp/<platform-arch>/package.json')`,
   compute absolute binary path from the resolved manifest. Return with `source:
   "npm-platform-pkg"`.
4. **PATH fallback** — only if `OPENPLANET_LSP_ALLOW_PATH=1` is set. Off by default to prevent
   "why is my LSP behaving weirdly" support tickets from random PATH binaries.
5. **Throw** — `BinaryNotFoundError` naming every location checked.

### Version Parsing

`--version` output format (from `openplanet-lsp v0.2.0` onward):
```
openplanet-lsp 0.2.0
```
Parser: `output.trim().split(' ')[1]` — trivially simple. If the format ever changes, a small
version-parser function lives in `binary-resolver` as the single place to update.

### Version Handshake Helper

```ts
export async function checkBinaryVersion(
  path: string,
  expected: string, // baked in at build time from BINARY_REF
): Promise<{ ok: boolean; actual: string; expected: string }>;
```

A version mismatch is a **warning, not an error.** The binary still runs; only the `--server-path`
override case can produce a mismatch, and users who set that knowingly run development builds.

### Tests

`packages/binary-resolver/tests/` covers: each resolution source, override-missing-fails-fast,
version parsing, version mismatch warning (does not throw), Windows `.exe` suffix, structured
error message format (lists all checked locations), `OPENPLANET_LSP_ALLOW_PATH` behaviour.

---

## 4. `openplanet-lsp` npm Package

**Package name:** `openplanet-lsp` (unscoped — friendly install UX)  
**Scope for platform packages:** ~~`@openplanet-lsp/<platform-arch>` (registered org)~~
**2026-08-17 errata:** the `@openplanet-lsp` org was never registered; the LSP
repo publishes **unscoped** platform packages (`openplanet-lsp-linux-x64`, …).
`binary-resolver` and any M2/M3 npm package must use the unscoped names.  
**Binary:** `openplanet-lsp` (matches Rust binary name)  
**Node:** `>=18`  
**Runtime deps:** platform packages (optional) + `binary-resolver` (bundled via tsup, no
`workspace:*` in published tarball)

### CLI Flag Surface

| Flag | Behaviour |
|---|---|
| *(none)* | Exec bundled binary as stdio LSP |
| `--version` | Print `openplanet-lsp wrapper X.Y.Z (binary A.B.C)` |
| `--server-path <path>` | Use this binary instead of bundled one |
| `--print-server-path` | Resolve, print absolute path, exit 0 |
| `--check` | Resolve, health check, print structured report, exit 0/1 |
| `--help` / `-h` | Usage |
| *(anything else)* | Passed through to the underlying binary |

### Key Implementation Choices

**`spawn` + passthrough, not `execve`-replace.** Costs ~30 MB RSS (one extra Node process) but
allows signal forwarding, pre-spawn logging, and sane exit code handling. For a long-lived LSP
server the overhead is irrelevant.

**Wrapper logs to stderr pre-spawn only, prefixed `[openplanet-lsp]`.** Once the child is
running we are completely silent — anything else would corrupt the LSP protocol stream.

**Unknown args pass through unchanged.** The binary currently ignores unknown flags (falls
through to stdio server). When real flags are added to the binary, the npm CLI surfaces them
automatically.

### Platform Package Schema

```json
{
  "name": "@openplanet-lsp/linux-x64",
  "version": "X.Y.Z",
  "os": ["linux"],
  "cpu": ["x64"],
  "main": "bin/openplanet-lsp",
  "files": ["bin/"],
  "license": "UNLICENSE"
}
```

npm/pnpm/yarn skip `optionalDependencies` that don't match host `os`/`cpu`. No postinstall
scripts — works under `--ignore-scripts` (important for agentic CLI sandbox environments).

### Tests

`packages/npm-lsp/tests/`: argv parser per flag + combinations, mock-child signal forwarding,
`--version` format, `--check` against a fake binary (happy path and non-zero exit), exit-code
propagation, integration tests against a packed tarball in a tmpdir.

---

## 5. `openplanet-lsp-vscode` Extension

**Display name:** OpenPlanet AngelScript  
**Publisher:** `<publisher-id>` (existing account, OQ-1)  
**Categories:** Programming Languages, Linters  
**Activation events:** `onLanguage:angelscript`, `workspaceContains:**/info.toml`  
**Language contributions:** registers `angelscript` id for `*.as`; registers `info.toml` by
filename pattern (so the LSP receives `didOpen` for it and surfaces manifest diagnostics per
spec D-007)

**Distribution:** platform-specific VSIXs via `vsce package --target <t>`. Six targets match the
npm platform matrix. CI drops the matching binary into `packages/vscode-ext/bin/` before each
`vsce package` invocation. The published VSIX contains exactly one binary.

**Open VSX:** the same six VSIXs are published to Open VSX (`publish-ovsx.yml`) so the extension
works in VSCodium, Cursor, Windsurf, code-server.

### Extension Entry Point (`src/extension.ts`, ~250 lines)

- Creates an output channel and a `LanguageStatusItem` on activation.
- Resolves the binary via `binary-resolver` with `extensionPath` set.
- Starts a `vscode-languageclient` `LanguageClient` in stdio mode.
- Updates the status item: spinning on start, green check on success, red error on failure.
- On failure: shows the output channel automatically with the `BinaryNotFoundError` message.
- Registers commands (see below) and a `onDidChangeConfiguration` handler.

### Settings (`openplanetLsp.*`)

VSCode settings are camelCase; they are translated to snake_case at the `initializationOptions`
boundary before being sent to the server.

| Setting | Type | Default | Init key (snake_case) |
|---|---|---|---|
| `serverPath` | string | `""` | *(not sent; extension-local)* |
| `openplanetDir` | string | `""` | `openplanet_dir` |
| `pluginsDir` | string | `""` | `plugins_dir` |
| `gameTarget` | enum: `TMNEXT` \| `TURBO` \| `auto` | `auto` | `game_target` (omitted when `auto`) |
| `defines` | string[] | `[]` | `defines` |
| `trace.server` | enum: `off` \| `messages` \| `verbose` | `off` | *(standard vscode-languageclient)* |

**`game_target: "auto"` means omit the key from `initializationOptions`** — the server applies
its default (`TMNEXT`). Sending `null` would be ignored but is noisier; omission is correct.

**Config layering (authoritative order, lowest → highest priority):**
1. Auto-detect
2. Workspace `.openplanet-lsp.toml`
3. User `~/.config/openplanet-lsp/config.toml`
4. `initializationOptions` (highest — set from extension settings)

All config file keys are snake_case. If a future extension feature writes `.openplanet-lsp.toml`,
it must use snake_case keys to match.

### Commands

| Command id | Label | Behaviour |
|---|---|---|
| `openplanetLsp.restart` | Restart Server | Stop + restart the language client |
| `openplanetLsp.showOutput` | Show Logs | Focus the output channel |
| `openplanetLsp.regenerateTypeDb` | Regenerate Type DB | Send `workspace/executeCommand` `openplanet.regenerateTypeDb` |

**`openplanetLsp.regenerateTypeDb` implementation notes:**
- The extension checks `InitializeResult.capabilities.executeCommandProvider.commands` before
  enabling the command. If the running server does not advertise `openplanet.regenerateTypeDb`,
  the command shows an info message: "This feature requires openplanet-lsp ≥ v0.2.0."
- On success: show information message with `message` from the response (`{ ok, message,
  regenerated?, durationMs? }`).
- On failure (`ok: false`): show error notification with `message` verbatim.

### `info.toml` Activation

The extension's `documentSelector` includes `{ scheme: "file", pattern: "**/info.toml" }`.
The server reacts to `textDocument/didOpen` for `info.toml` via URI suffix match (see
`src/server/diagnostics.rs`). The server does NOT walk the workspace autonomously for `info.toml`
files at initialize time — that is a deferred enhancement filed on the LSP side.

### Settings Change Behaviour

Changes to `serverPath`, `openplanetDir`, `pluginsDir`, `gameTarget`, `defines` prompt a restart
notification (these are only read at init time). Changes to `trace.server` are hot-reloadable via
`vscode-languageclient`'s built-in mechanism.

### Tests

`packages/vscode-ext/tests/`:
- **Unit** (no electron): settings translator (camelCase → snake_case, all keys), `gameTarget:
  "auto"` produces absent key, `regenerateTypeDb` capability feature-detection.
- **Integration** (`@vscode/test-electron`): launch headless VSCode, open fixture `*.as`, assert
  language client reaches `Running`, assert ≥1 diagnostic, assert status item shows success.
- **Negative path**: missing binary → status item shows error, output channel contains
  `BinaryNotFoundError` structured message.

---

## 6. TextMate Grammar + Automated Grammar Tests

### Authoring

Single source: `packages/grammar/src/angelscript.tmLanguage.yaml`  
Build step: `packages/grammar/build.ts` — validates structure, compiles YAML → JSON, copies to
`packages/vscode-ext/syntaxes/angelscript.tmLanguage.json`.  
The compiled JSON is committed; `verify-grammar-sync.ts` fails CI if YAML and committed JSON
diverge.

**Starting point: fresh (Path B).** No fork of the existing extension's grammar. We own every
regex from day one.

### Scope of the Grammar

Responsible for fast, robust, good-enough coloring while typing. The LSP is the source of truth
for semantic information. The grammar's job is syntactic token classification only.

AngelScript features the grammar must cover (v1):
- Class, interface, enum, namespace declarations
- Function declarations (including `void`, `auto`, generic type params)
- Attribute syntax (`[Setting category="..."]`, `[NoPrint]`, etc.)
- Preprocessor directives (`#include`, `#if`, `#endif`, `#define`, `#ifdef`, etc.)
- OpenPlanet coroutine primitives (`startnew`, `yield`)
- String literals (single/double quoted, escape sequences)
- Numeric literals (integer, float, hex)
- Line and block comments
- Keywords (`class`, `if`, `while`, `return`, `const`, `auto`, etc.)
- Built-in types (`int`, `float`, `bool`, `string`, `array`, `dictionary`, etc.)
- `info.toml` — standard TOML grammar (reuse an existing TOML TextMate grammar via `include`)

### Test Framework: `vscode-tmgrammar-test`

Test files are annotated `*.as` files where comment lines assert which scope each character gets:

```angelscript
// SYNTAX TEST "source.angelscript" "class declaration"
class MyPlugin {
//^^^^ storage.type.class.angelscript
//    ^^^^^^^^ entity.name.type.class.angelscript
```

CI fails on any per-character scope mismatch.

### Test Corpus (option 10c — inline)

`packages/grammar/tests/`:
- **`fixtures/`** — ~30 hand-written micro-fixture `*.as` files, one per language feature.
  These are the unit tests of the grammar.
- **`corpus/`** — 50+ real OpenPlanet plugin files for snapshot testing. Inline in the repo.
  Snapshot files record the full scope-stream per file; regressions require explicit `--update`
  approval. Corpus is refreshed periodically (see `docs/internal/update-corpus-prompt.md`).
- **`negative/`** — ~10 intentionally malformed files; assert the grammar produces some output
  without infinite loops and error scopes don't leak.

### Autonomous Improvement Loop

1. Identify a tokenization bug (wrong scope on real plugin code).
2. Add a failing micro-fixture in `fixtures/` asserting the correct scopes.
3. Edit `angelscript.tmLanguage.yaml`.
4. `just test-grammar` — micro-fixture passes; snapshot diff is reviewed.
5. Commit. CI enforces.

### Corpus Update Agent Prompt

`docs/internal/update-corpus-prompt.md` contains a reusable agent prompt. The agent:
1. Accepts input (changelog, news post, code samples).
2. Asks clarifying questions to understand what changed in the language or API.
3. Adds / updates files in `packages/grammar/tests/corpus/`.
4. Runs `just test-grammar-snapshot --update` and presents the diff for human approval.
5. Commits once approved.

---

## 7. CI / Release Pipeline

### Workflow Files

| File | Trigger | Purpose |
|---|---|---|
| `ci.yml` | PR, push to main | Fast checks: lint, typecheck, unit tests, grammar, pkg-shape |
| `integration.yml` | PR (labeled), push to main | VSCode electron, npm CLI smoke, editor configs |
| `build-binaries.yml` | Reusable (called by others) | Cross-compile all six targets |
| `release.yml` | Tag `vX.Y.Z` | Full release: build → artifacts → publish |
| `publish-npm.yml` | Called by release.yml | Publish platform + main npm packages |
| `publish-vsce.yml` | Called by release.yml | Publish six VSIXs to Marketplace |
| `publish-ovsx.yml` | Called by release.yml | Publish six VSIXs to Open VSX |
| `nightly.yml` | Disabled (`if: false`) | Build against LSP main nightly, file issue on failure |
| `codeql.yml` | PR, weekly | CodeQL security scan (no secrets) |

### `ci.yml` Jobs (all secret-free, every PR)

| Job | What | OS |
|---|---|---|
| `lint` | eslint + prettier check | ubuntu |
| `typecheck` | tsc --noEmit per package | ubuntu |
| `unit` | pnpm -r test | ubuntu / macos / windows |
| `grammar-test` | vscode-tmgrammar-test fixtures + snapshots | ubuntu |
| `grammar-yaml-json-sync` | rebuild grammar, fail if committed JSON drifted | ubuntu |
| `pkg-shape` | pnpm pack each package, assert tarball contents | ubuntu |
| `dry-run-vsce-package` | build one platform VSIX, no publish | ubuntu |
| `bin-version-sync` | assert BINARY_REF matches the bundled binary's `--version` | ubuntu |
| `verify-ci-parity` | assert `just ci` steps ≡ `ci.yml` steps | ubuntu |

### `release.yml` — Tag-Triggered, Secrets-Independent End-to-End

Steps 1–6 always run; steps 7–9 are secret-gated:

1. Validate tag format; assert it matches all `package.json` versions.
2. Call `build-binaries.yml` → six binary artifacts.
3. Stage npm platform packages with binaries (`stage-platform-package.ts` × 6).
4. Stage six VSIX files with binaries (`stage-vsce-bin.ts` × 6, then `vsce package --target`).
5. Upload everything as workflow artifacts (always available regardless of publish outcome).
6. Create GitHub Release with binaries + VSIXs attached (uses `GITHUB_TOKEN`, always).
7. Call `publish-npm.yml` — **gated on `NPM_TOKEN`**; skips with a summary note if absent.
8. Call `publish-vsce.yml` — **gated on `VSCE_PAT`**; skips with a summary note if absent.
9. Call `publish-ovsx.yml` — **gated on `OVSX_PAT`**; skips with a summary note if absent.

**Dry-run releases:** tag with any `-dry` suffix (e.g., `v0.0.0-dry`). Steps 1–6 run in full;
steps 7–9 skip because the tag pattern doesn't match the publish condition. Inspect all artifacts
before ever configuring publish secrets.

### `publish-npm.yml` — Platform Packages First

Publishes `@openplanet-lsp/linux-x64` … through `@openplanet-lsp/win32-arm64` first, then the
main `openplanet-lsp` package. Users who resolve the main package during the publish window
always find the platform packages already present. Uses `npm publish --provenance` for SLSA build
provenance (requires `id-token: write`).

### `build-binaries.yml` — Binary Version Pinning

Clones `../lsp-openplanet` at the git ref in the `BINARY_REF` file. No submodule. Caches Cargo
`~/.cargo` and `target/` by (ref, target). Uses `cross` for Linux ARM cross-compilation. Uploads
each binary as a named artifact `openplanet-lsp-<target>`.

### Environment Protection Rules

Configure GitHub environments `npm`, `vsce`, `ovsx` requiring manual approval before the first
publish. Secrets are scoped per environment.

### Workflow Run Summaries

Every workflow writes a markdown summary to `$GITHUB_STEP_SUMMARY` listing: what was built, what
was skipped (and why), links to artifacts.

### Versioning Policy

Versioning is manual for v1. Process: bump all `package.json` versions + `BINARY_REF` using
`just bump X.Y.Z` (calls `scripts/bump-version.ts`), commit, push tag. No release-please or
changesets in v1.

---

## 8. Editor Documentation + Internal Upstream Playbook

### Public Documentation (`docs/editor-setup/`)

One file per editor. Each has:
- **Minimal snippet** — copy-paste to get started (5 minutes or less).
- **Advanced snippet** — full configuration with all available options.
- **Verify your setup** section — open a fixture `*.as` file with a known diagnostic, confirm
  it appears. Same fixture across all four docs.
- **Troubleshooting** — how to see LSP logs, how to use `--server-path`, how `--check` helps.

**`nvim.md`:**
- Minimal: `vim.lsp.start` against `openplanet-lsp` on `$PATH` (installed via
  `npm i -g openplanet-lsp`).
- Advanced: `nvim-lspconfig` manual config (user-defined server entry; not upstream in v1).
- Notes on Mason: how to install once the Mason registry entry lands (internal playbook).

**`sublime.md`:**
- Prerequisite: `LSP` Package Control package.
- JSON snippet for `LSP.sublime-settings` defining `openplanet-lsp` as a custom client,
  matching on `source.angelscript`.
- Note on grammar: the AngelScript TextMate grammar must also be installed (link to the VSIX
  or a future Package Control submission).

**`opencode.md`:**
- opencode LSP config snippet (exact config shape to be verified at implementation time — OQ-7).

**`claude-code.md`:**
- Claude Code LSP config snippet (exact config shape to be verified at implementation time —
  OQ-8).

### Internal Documentation (`docs/internal/`)

**`upstreaming-playbook.md`:** How we'd execute B and C (not in v1). Covers:
1. **nvim-lspconfig PR** — target file (`lua/lspconfig/configs/openplanet_lsp.lua`), root_dir
   logic, default `cmd`, documentation requirements, contribution checklist, recent similar PRs
   as templates.
2. **Mason registry** — repo (`mason-org/mason-registry`), package schema (binary source from
   GitHub Releases), CI requirements, recent similar entries.
3. **Sublime Package Control** — repo (`wbond/package_control_channel`), `repository.json`
   schema, naming conventions, review timeline.
4. **Open VSX auto-sync** — namespace ownership, CI publish, verification in VSCodium/Cursor.
5. **Trigger criteria** — explicit conditions for when to submit each upstream PR (e.g., "after
   v1.0 is stable for 30 days with no P1 bugs").

**`ci-runbook.md`:** How to enable gated CI pieces — minting NPM_TOKEN / VSCE_PAT / OVSX_PAT,
setting up GitHub environment protection, enabling the nightly workflow, dry-run release
procedure, incident playbook for yanking a bad release from npm/Marketplace/Open VSX.

**`release-checklist.md`:**
- Pre-tag: `just pre-release-check` exits 0; BINARY_REF + all versions aligned; CHANGELOG
  updated.
- Post-publish (manual): install the extension from Marketplace on at least one non-Linux OS;
  install the npm package via `npm i -g openplanet-lsp` and run `--check`; verify Open VSX
  listing shows the new version (note: Open VSX sometimes lags Marketplace by hours).
- Dogfooding week: use the extension and agentic CLIs for real plugin work; file issues.

**`local-dev.md`:** Full `just` target catalog with examples, dev-script inventory,
troubleshooting for `fetch-openplanet-lsp.ts` (Cargo errors, glibc mismatch), pnpm cache
issues, `act` gotchas.

**`update-corpus-prompt.md`:** Reusable agent prompt for updating the grammar test corpus. See
Section 10 for details.

**`manual-sublime-verification.md`:** If `smoke-sublime.ts` turns out to be impractical,
this document is the fallback: step-by-step manual verification for a Sublime LSP setup,
run before each release.

---

## 9. `justfile`, Dev Scripts, Local CI Validation

### `justfile` Targets

```
# ─── setup ───────────────────────────────────────────────────────────────────
default                   # list all targets
install                   # pnpm install
bootstrap                 # install + fetch-binary (host platform) + build-grammar
fetch-binary REF=""           # clone lsp-openplanet at REF (default: reads BINARY_REF file), cargo build, cache
clean                     # rm -rf node_modules dist packages/*/dist artifacts/

# ─── build ───────────────────────────────────────────────────────────────────
build                     # pnpm -r build
build-grammar             # YAML → JSON, copy into vscode-ext/syntaxes/
build-resolver            # tsup the binary-resolver package
build-npm                 # tsup the npm-lsp package
build-vsce TARGET         # vsce package --target <TARGET>

# ─── test ────────────────────────────────────────────────────────────────────
test                      # pnpm -r test (unit tests all packages)
test-grammar              # vscode-tmgrammar-test (fixtures + corpus snapshots)
test-grammar-snapshot     # snapshot tests; pass --update to approve changes
test-integration          # VSCode electron smoke + npm CLI smoke
test-editor-configs       # headless nvim (+ Sublime if practical)
stress N="100"            # run integration suite N times (for race condition hunting)

# ─── lint / typecheck ────────────────────────────────────────────────────────
lint                      # eslint + prettier check
lint-fix                  # eslint --fix + prettier --write
typecheck                 # pnpm -r tsc --noEmit

# ─── CI (mirrors GitHub Actions) ─────────────────────────────────────────────
ci                        # lint + typecheck + test + grammar-test + grammar-sync + pkg-shape + verify-ci-parity
ci-full                   # ci + test-integration + test-editor-configs
ci-act JOB="ci"           # run specific workflow job via nektos/act
pre-release-check         # comprehensive pre-tag: ci-full + verify-grammar-sync + dry-run-release

# ─── release ─────────────────────────────────────────────────────────────────
stage-platform TARGET     # fetch binary, populate npm-lsp-platforms/<target>/bin/
stage-vsce TARGET         # fetch binary, populate vscode-ext/bin/, vsce package
dry-run-release           # end-to-end: fetch + stage all platforms + pack + npm publish --dry-run
bump VERSION              # update all package.jsons + BINARY_REF, commit

# ─── utilities ───────────────────────────────────────────────────────────────
grammar-debug FILE        # tokenize FILE with current grammar, pretty-print scopes
check-binary              # openplanet-lsp --check against bundled binary (all resolution sources)
```

### Dev Scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `fetch-openplanet-lsp.ts` | Clone `../lsp-openplanet` at `BINARY_REF`, `cargo build --release --target X`, copy to `.cache/binaries/<ref>/<target>/`. Caches by (ref, target). |
| `stage-platform-package.ts` | Copy cached binary into `packages/npm-lsp-platforms/<target>/bin/`. |
| `stage-vsce-bin.ts` | Copy cached binary into `packages/vscode-ext/bin/`. |
| `verify-ci-parity.ts` | Parse `ci.yml` steps + `justfile` `ci:` recipe; fail if any step present in one but absent from the other. Itself runs in CI. |
| `verify-grammar-sync.ts` | Rebuild grammar from YAML, `git diff --exit-code` on the JSON; fail if different. |
| `bump-version.ts` | Update every `package.json` + `BINARY_REF`, run `pnpm install` (rewrites lockfile), create commit. |
| `health-check.ts` | Try every resolution source, print a table showing which succeeded. |
| `smoke-nvim.ts` | Spawn headless nvim with the documented config snippet, open a fixture, assert diagnostics arrive within 30s. |
| `smoke-sublime.ts` | Same for Sublime if practical (see OQ-9). |

### Local CI Validation — Three Layers

**Layer 1 — `just ci` (daily use, ~30–60s):**  
Runs lint, typecheck, unit tests, grammar tests, grammar-yaml-json-sync, pkg-shape, and
`verify-ci-parity`. Mirrors `ci.yml` exactly. If `just ci` passes locally, the PR check should
pass in GitHub Actions.

**Layer 2 — `just ci-full` (pre-push, ~2–5 min):**  
Adds integration tests and editor-config smoke tests. Run before pushing a release tag.

**Layer 3 — `just ci-act JOB=ci` (workflow YAML debugging):**  
Uses `nektos/act` to run the actual workflow YAML in Docker. Secondary validator; primary value
is debugging workflow YAML structure issues, not daily use. `act` has limitations: no
macOS/Windows containers, some actions have Docker image surprises, caching differs.

**`verify-ci-parity.ts` — the meta-test:**  
Parses both `ci.yml` step commands and the `ci:` `justfile` recipe; asserts they invoke the same
commands. Prevents "works locally but fails in CI" drift. Runs in CI itself.

**What cannot be validated locally:**
- Publish steps (use `npm publish --dry-run`; `just pre-release-check` covers this).
- Secret-gated jobs (gating logic is unit-tested; actual authenticated publish is not).
- Cross-OS matrix rows (CI is authoritative for macOS/Windows; mitigated by explicit
  Windows-path unit tests in `binary-resolver`).

---

## 10. Consolidated Test Strategy

### Test Pyramid

| Layer | Command | Runtime | Runs on |
|---|---|---|---|
| 1 — Unit | `just test` | ~15s (local), ~60s (CI matrix) | Every commit |
| 2 — Grammar | `just test-grammar` | ~10s | Every commit |
| 3 — Integration | `just test-integration` | ~2–5 min | main + labeled PRs |
| 4 — Editor config | `just test-editor-configs` | ~30–60s | main only |
| 5 — Release validation | `just dry-run-release` | ~5–15 min | Manual pre-tag |

### Unit Test Coverage (Layer 1)

| Package | Tests |
|---|---|
| `binary-resolver` | ~30 — resolution sources, override-fail-fast, version parser, Windows paths, structured error |
| `npm-lsp` | ~20 — argv parser, signal forwarding (mock child), exit-code propagation |
| `vscode-ext` (unit only) | ~15 — settings translator, game_target omission, capability feature-detection |
| `grammar` | ~10 — YAML→JSON roundtrip, schema validation, JSON hash stability |

### Grammar Tests (Layer 2)

- **~30 micro-fixtures** — one per AngelScript language feature, annotated with expected scopes.
- **~50 corpus snapshots** — real plugin files; snapshot mode in CI, update mode locally.
- **~10 negative tests** — malformed input; assert no crash and no scope leak.

### Integration Tests (Layer 3)

- **VSCode electron smoke** — real headless VSCode, fixture plugin, client reaches `Running`,
  ≥1 diagnostic appears, status bar shows success. Runs on ubuntu + macos + windows.
- **npm CLI smoke** — install packed tarball, run `--version`/`--check`/`--print-server-path`,
  send `initialize` LSP request and verify response. Runs on ubuntu + macos + windows.
- **Grammar CI parity** — rebuild grammar, `git diff --exit-code`.
- **CI parity meta-test** — `verify-ci-parity.ts`.

### Editor Config Smoke (Layer 4)

- **Headless nvim** (`smoke-nvim.ts`) — ubuntu only.
- **Headless Sublime** (`smoke-sublime.ts`) — if practical (OQ-9), else manual checklist.
- **opencode + claude-code** — agentic CLI stubs; disabled until CI dependency decision.

### Release Validation (Layer 5)

`just pre-release-check` runs Layers 1–3, grammar sync, and a full dry-run release:
- `npm publish --dry-run` for every package.
- `vsce ls` on every VSIX.
- Size report for all artifacts.

### Explicit Blind Spots

1. **Marketplace platform-dispatch correctness.** Cannot test without publishing.
   → Manual verification on at least one non-Linux OS after each release (see
   `docs/internal/release-checklist.md`).
2. **Open VSX serving.** Same.
   → Manual verification; note that Open VSX may lag Marketplace by hours.
3. **Real-world plugin corpus rot.** Snapshot corpus was valid at a point in time.
   → Quarterly refresh using the corpus update agent prompt in
   `docs/internal/update-corpus-prompt.md`. The agent takes changelog/news/code samples as
   input, asks clarifying questions, updates `packages/grammar/tests/corpus/`, runs
   `just test-grammar-snapshot --update`, and presents the diff for human approval before
   committing.
4. **LSP protocol race conditions.** `just stress N=100` is the tool; not run in CI.
5. **Real agentic-CLI usage.** Automated smoke covers initialization; full conversational use
   requires a dogfooding period. Scheduled after first real release (see release checklist).

---

## 11. Assumptions, Open Questions, Risks, v1 Milestone Plan

### Assumptions

| # | Assumption | Validated by | Consequence if wrong |
|---|---|---|---|
| A-1 | `openplanet-lsp v0.2.0` is pushed and fetchable | **Resolved** — tag live at `github.com/clankercode/lsp-openplanet` | n/a |
| A-2 | `openplanet-lsp` npm name available | **Resolved** — registered | n/a |
| A-3 | `@openplanet-lsp` npm org available | Claim before first publish | Need different scope name |
| A-4 | VSCode Marketplace publisher account exists | OQ-1 — partially resolved | Create account first |
| A-5 | `cross` cross-compiles all six targets successfully | First `build-binaries.yml` run | Restrict target matrix |
| A-6 | `vsce package --target` works for all six targets | First `build-vsce.yml` run | Fall back to universal VSIX + runtime download |
| A-7 | `BINARY_REF`-based fetch is reproducible across machines | First `just dry-run-release` | Need submodule or different strategy |
| A-8 | `nektos/act` is useful for local workflow debugging | First `just ci-act` run | Remove `ci-act` target, keep `just ci` |
| A-9 | LSP init options + regenerateTypeDb command are stable in v1 timeframe | Coordination with LSP agent | Extension settings schema churns |

### Open Questions

| # | Question | Status | Blocker? |
|---|---|---|---|
| OQ-1 | VSCode Marketplace publisher id | Existing account, id to be supplied | No — needed at first publish |
| OQ-2 | regenerateTypeDb command shape | **Resolved** — `workspace/executeCommand`, confirmed shape | — |
| OQ-3 | Test corpus location | **Resolved** — 10c (inline) | — |
| OQ-4 | Binary version tracking mechanism | **Resolved** — `BINARY_REF` file | — |
| OQ-5 | `lsp-openplanet` as submodule vs ref | **Resolved** — fetched by ref, no submodule | — |
| OQ-6 | Mason registry submission | Internal playbook only | No |
| OQ-7 | opencode LSP config shape | Verify at implementation time | No |
| OQ-8 | claude-code LSP config shape | Verify at implementation time | No |
| OQ-9 | Sublime headless testing practicality | Determine at implementation time | No |
| OQ-10 | `../lsp-openplanet` remote URL | **Resolved** — `https://github.com/clankercode/lsp-openplanet` | — |
| OQ-11 | `v0.2.0` tag reachable at remote | **Resolved** — tag pushed, annotated, points to `4a916fd` | — |
| OQ-12 | License | **Resolved** — UNLICENSE | — |

### Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R-1 | Marketplace rejects platform-targeted VSIXs | Medium | Fallback to 3a (universal VSIX + runtime download) |
| R-2 | Optional-dep resolution behaves unexpectedly in agentic CLI sandboxes | Medium | `--check` / `--print-server-path` give visibility; integration tests cover agentic CLIs |
| R-3 | `--version` output format changes silently | Low | Parser is permissive; version mismatch is a warning not an error |
| R-4 | Grammar test flakiness from vscode-oniguruma version drift | Low | Pin grammar engine version in lockfile |
| R-5 | `cross` Linux ARM binaries have glibc symbol issues | Medium | Pin glibc target via Docker image; document minimum glibc version |
| R-6 | Open VSX lags Marketplace post-release | Low | Document lag; link both in README |
| R-7 | Wrapper and LSP drift out of sync | Medium | `BINARY_REF` pins exact tag; CI version-handshake check |
| R-8 | Corpus update agent introduces unreviewed regressions | Low | Agent prompt requires explicit snapshot diff review + human approval before commit |

### v1 Milestone Plan

| Milestone | Deliverable | Exit criterion |
|---|---|---|
| M1 — Foundation | pnpm workspace, justfile, BINARY_REF, CI (no publish), docs scaffold, binary-resolver with tests | `just ci` passes |
| M2 — npm (one platform) | fetch-openplanet-lsp, stage scripts, npm-lsp, linux-x64 | Local `npm install` + `--check` works |
| M3 — npm (all platforms) | Cross-compile matrix, all 6 platform packages, build-binaries CI | `just dry-run-release` produces 6 working tarballs; integration smoke passes per OS |
| M4 — VSCode (one platform) | vscode-ext, LSP client, status bar, settings, regenerateTypeDb, linux-x64 VSIX | Install VSIX, open fixture, see diagnostics |
| M5 — Grammar | YAML grammar written fresh, micro-fixtures, corpus (10c), snapshot tests, grammar-sync | `just test-grammar` passes; corpus snapshots committed |
| M6 — VSCode (all platforms) | Matrix VSIX builds, publish-vsce + publish-ovsx jobs wired | 6 VSIXs in CI; manual install verified on non-Linux |
| M7 — Editor docs | nvim, Sublime, opencode, claude-code docs; smoke-nvim passing | Fresh user follows any doc, gets diagnostics in <5 min |
| M8 — Release readiness | release.yml complete, all internal docs written, update-corpus-prompt.md, first dry-run tag `v0.0.0-dry` | Dry-run green; maintainer satisfied |
| M9 — First real release | Tag v0.1.0, publish secrets configured, artifacts published, dogfooding begins | AC-1 through AC-10 verified |

### Documentation Deliverables

**Public:**
- `README.md` — elevator pitch, install per target, links
- `packages/npm-lsp/README.md` — npm install, CLI usage, troubleshooting
- `packages/vscode-ext/README.md` — Marketplace listing, feature list, settings reference
- `docs/editor-setup/nvim.md`, `sublime.md`, `opencode.md`, `claude-code.md`
- `CONTRIBUTING.md` — dev workflow, just targets, testing expectations
- `CHANGELOG.md` — Keep-a-Changelog format
- `LICENSE` — UNLICENSE

**Internal:**
- `docs/internal/upstreaming-playbook.md`
- `docs/internal/ci-runbook.md`
- `docs/internal/release-checklist.md`
- `docs/internal/local-dev.md`
- `docs/internal/update-corpus-prompt.md`
- `docs/internal/manual-sublime-verification.md` (if OQ-9 → impractical)
