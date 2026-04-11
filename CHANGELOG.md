# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
