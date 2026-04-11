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
    pnpm test

lint:
    pnpm lint

format:
    pnpm format

format-check:
    pnpm format:check

typecheck:
    pnpm typecheck

# ─── CI mirror ────────────────────────────────────────────────────────────
verify-pkg-shape:
    pnpm exec tsx scripts/verify-pkg-shape.ts

verify-ci-parity:
    pnpm exec tsx scripts/verify-ci-parity.ts

ci: lint format-check typecheck test verify-pkg-shape verify-ci-parity
