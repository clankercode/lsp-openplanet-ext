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
