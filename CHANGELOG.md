# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
