# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `openplanetLsp.inactiveRegions` — grey out `#if` branches your current
  defines switch off, the way an IDE fades `#if 0` in C, so you can see which
  code your `gameTarget` / `signatureMode` have turned off. `hint` (the server
  default) fades without listing, `info` also lists in the Problems panel,
  `ignore` marks nothing. No warning/error level, and `check` never reports
  these — the branch is dead by design, not a defect. Forwarded as
  `inactive_regions`; left empty nothing is sent. Needs the fade to be enabled
  (`editor.showUnused`, on by default) and openplanet-lsp with server B031.

- `openplanetLsp.unused` — how unused functions / variables / parameters /
  class members are reported: `hint` (greyed out in the editor, kept out of the
  Problems panel), `info` (greyed out and listed), `warn` (the server default),
  `error`, or `ignore`. `hint` and `info` never fail a `check`. Forwarded to the
  server as `unused`; left empty nothing is sent, so a workspace
  `.openplanet-lsp.toml` stays in control. Needs openplanet-lsp with server
  B030 (the quiet levels and the `Unnecessary` diagnostic tag).

- `openplanetLsp.signatureMode` — pick which Openplanet signature level the
  analysis models (`developer` default, then `school`, `regular`, `official`).
  The levels are cumulative (a macro is defined when the current level is equal
  or below its own), so `official` gives `SIG_OFFICIAL` alone and `developer`
  gives all four. Forwarded to the server as `signature_mode`; left at
  `developer` nothing is sent, so a workspace `.openplanet-lsp.toml` stays in
  control. Needs openplanet-lsp with GH #64.

### Changed

- `openplanetLsp.defines` documentation now matches the server: entries are
  **added** to the game-target/signature defines and `info.toml`
  `[script].defines` rather than replacing them, and `-NAME` / `!NAME` turns a
  define off. The old "replaces the game-target defaults" wording was stale.

## [0.3.0] - 2026-08-17

First release with a live CI pipeline, a modernized grammar, and a hardened
extension — wraps `openplanet-lsp` **v0.5.0** (was v0.2.0).

### Added

- `RELEASE.md`: agent/human release playbook (tag-driven releases, changelog
  requirement, post-CI checklist).
- Extension settings: `openplanetLsp.serverPath`, `openplanetLsp.gameTarget`
  (TMNEXT/MP4/MP40/MP41/TURBO/MP3/UNITED_FOREVER/UNITED/NATIONS_FOREVER —
  flips preprocessor defines so dead `#if` branches match the real game),
  `openplanetLsp.openplanetDir`, `openplanetLsp.pluginsDir`. Set values are
  forwarded to the server as `initializationOptions`; unset ones are omitted
  so a repo-local `.openplanet-lsp.toml` keeps precedence.
- `openplanetLsp.restart` command; debounced automatic restart on settings
  change (the server reads config at initialize only).
- Output channel (`Openplanet LSP`), status bar item, and spawn-failure
  surfacing with an "Open Settings" action — the language server failing to
  start is no longer silent.
- `info.toml` added to the document selector so the server's plugin-manifest
  diagnostics surface in VS Code.
- Extension README (marketplace listing: features, zero-setup expectation,
  settings table).
- Grammar: preprocessor directives (`#include`, `#if/#elif/#else/#endif`,
  `#define`…), meta attributes (`[Setting …]`, `[SettingsTab …]`, …),
  triple-quoted `"""…"""` strings, single-quoted strings, binary/octal/hex
  numerics with `_` separators, float suffixes (`f`/`F`, `25.`, `25.f`),
  exponents, `::` namespace separator, `@` handles, word operators
  (`and`/`or`/`not`/`xor`/`is`).
- Grammar test suite: real-Oniguruma scope assertions over a representative
  corpus (14 tests).
- CI: release builds now smoke-check VSIX contents (`dist/extension.js`,
  grammar JSON present).

### Fixed

- CI never ran: push/PR triggers targeted `main` but the default branch is
  `master` (`ci.yml`, `codeql.yml`, `integration.yml`).
- Release binaries were non-executable after extraction (upload-artifact
  delivers mode 644; binaries are now `chmod +x` before archiving).
- binary-resolver looked up scoped `@openplanet-lsp/*` npm packages; the
  server publishes unscoped `openplanet-lsp-<platform>` (v0.5.0 verified on
  the registry).
- Extension PATH fallback was dead code (`asAbsolutePath()` never returns
  falsy); resolution now checks existence and falls back to a bare PATH
  spawn, wiring the `binary-resolver` package with structured
  `BinaryNotFoundError` diagnostics.
- Language config: `<>` bracket pair (poisoned bracket matching on `a < b`
  comparisons) removed; single-quote pairs with `string`/`comment` guards
  added; `//` comment continuation on Enter.
- Grammar false keywords removed: `throw`/`from`/`ref`/`explicit`/
  `external`/`foreach` are not AngelScript keywords (the server lexer treats
  them as identifiers; `from` is deliberately contextual).
- actionlint/shellcheck findings in workflows (secret interpolation,
  SC2129/SC2012/SC2035 patterns, constant `if: false`).

### Changed

- `BINARY_REF` v0.2.0 → **v0.5.0**: release binaries are built from
  `openplanet-lsp` v0.5.0 (142 server commits of diagnostics/type-db work
  since the previously pinned version).
- Nightly workflow cron disabled (was burning a skipped run daily);
  dispatch-only until M8.
- `build-binaries.yml` now requests least-privilege `contents: read`.

### Distribution

- GitHub Release `v0.3.0`: six platform binary archives, the VSIX, and
  SHA256SUMS. npm/Marketplace/OVSX publish fan-outs remain secrets-gated
  stubs (not yet configured).

## [0.2.0] - 2026-04-12

### Added

- `packages/grammar`: AngelScript TextMate grammar authored in YAML, compiled to JSON via `build.ts`. Covers keywords, types, control flow, operators, comments, strings, numeric literals, and escape sequences.
- `packages/vscode-ext`: VS Code extension (`openplanet-lsp-vscode`). Contributes the AngelScript language (`*.as`), TextMate grammar, bracket/comment configuration, and an LSP client that launches `openplanet-lsp` as a stdio language server. Binary resolution order: `openplanetLsp.serverPath` setting → bundled `bin/` (populated at release time) → PATH.
- `scripts/bump-version.ts`: Updates all workspace `package.json` files to a given version. 10 unit tests.
- Release pipeline now builds a VSIX (`openplanet-lsp-vscode-vX.Y.Z.vsix`) in parallel with the binary matrix and attaches it to every GitHub Release alongside the platform binary archives and `SHA256SUMS`.
- `just build-grammar`, `just build-vsce`, `just bump VERSION`, `just pre-release-check VERSION` recipes.
- `verify-pkg-shape.ts`: VS Code extensions (detected via `engines.vscode`) are exempt from the `type: module` + `types` + `files` requirements, since they are private CJS bundles. New test covering this case.

## [0.1.0] - 2026-04-12

### Added

- Monorepo skeleton: pnpm workspace, TypeScript base config, ESLint flat config, Prettier, justfile.
- `binary-resolver` package with full TDD coverage: platform detection, version parsing, binary version handshake, and four-source resolution (override, vscode-bundle, npm-platform-pkg, opt-in PATH).
- Complete CI workflow files: `ci.yml` (lint, typecheck, unit, pkg-shape, ci-parity, workflow-lint), plus stubs for integration, nightly, codeql.
- `verify-ci-parity.ts` meta-test enforcing that `just ci` and `ci.yml` invoke the same command set, now robust to YAML block-scalar markers in multi-line `run:` blocks.
- Release pipeline:
  - `scripts/validate-release-tag.ts` — parses `v*` semver tags, detects `-dry` dry-run tags, and asserts that every workspace `package.json` version matches the tag. Covered by 14 unit tests.
  - `scripts/extract-changelog.ts` — extracts a Keep-a-Changelog section (`[Unreleased]` or a versioned `[X.Y.Z]` entry) for use as release body. Covered by 8 unit tests.
  - `build-binaries.yml` — reusable workflow that cross-builds the `openplanet-lsp` binary at `BINARY_REF` for all six target-runtime combinations (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`) and uploads each as a named artifact.
  - `release.yml` — end-to-end tag-triggered pipeline: validates tag, calls `build-binaries.yml`, archives each binary (`.tar.gz` on unix, `.zip` on windows), emits a `SHA256SUMS` file, extracts the CHANGELOG body for the tag, creates a GitHub Release via `gh release create`, and fans out to `publish-npm` / `publish-vsce` / `publish-ovsx`.
  - Dry-run release tags (`v*-dry*`) run the full pipeline but skip the publish-\* fan-out and mark the release as a prerelease. Dry runs fall back to `[Unreleased]` if no versioned CHANGELOG section exists yet.
  - `publish-npm.yml` / `publish-vsce.yml` / `publish-ovsx.yml` are reusable stubs that cleanly no-op when their respective secret (`NPM_TOKEN` / `VSCE_PAT` / `OVSX_PAT`) is missing, so unconfigured forks can still exercise the full release flow.
  - `just validate-release-tag`, `just extract-changelog`, `just lint-workflows` recipes, and a new `lint-workflows` CI job that installs and runs `actionlint`.
