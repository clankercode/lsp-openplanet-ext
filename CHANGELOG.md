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
