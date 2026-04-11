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
