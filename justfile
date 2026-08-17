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
    pnpm build

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

# Requires `actionlint` on PATH. Install via:
#   go install github.com/rhysd/actionlint/cmd/actionlint@latest
#   # or: pacman -S actionlint / brew install actionlint
lint-workflows:
    actionlint -no-color

ci: lint format-check typecheck build test verify-pkg-shape verify-ci-parity lint-workflows

# ─── grammar / vscode-ext ─────────────────────────────────────────────────
# Compile AngelScript grammar YAML → JSON and copy to vscode-ext/syntaxes/.
build-grammar:
    pnpm exec tsx packages/grammar/build.ts

# Build and package the VS Code extension VSIX.
build-vsce:
    pnpm --filter openplanet-lsp-vscode build
    pnpm --filter openplanet-lsp-vscode package

# Build the VSIX into dist/ at the repo root (gitignored).
build-vsix:
    mkdir -p dist
    pnpm --filter openplanet-lsp-vscode build
    pnpm --filter openplanet-lsp-vscode exec vsce package --no-dependencies --out ../../dist/openplanet-lsp-vscode.vsix

# ─── release helpers ──────────────────────────────────────────────────────
# Bump all workspace package.json files to a new version.
bump VERSION:
    pnpm exec tsx scripts/bump-version.ts {{VERSION}}

# Validate a release tag locally before pushing it.
validate-release-tag TAG:
    pnpm exec tsx scripts/validate-release-tag.ts {{TAG}}

# Print the CHANGELOG section for a version (or "Unreleased").
extract-changelog VERSION:
    pnpm exec tsx scripts/extract-changelog.ts {{VERSION}}

# Pre-release checklist: verify versions, validate tag, confirm changelog exists.
pre-release-check VERSION:
    just validate-release-tag v{{VERSION}}
    pnpm exec tsx scripts/extract-changelog.ts {{VERSION}}
    # Fail early on a bad BINARY_REF pin instead of at release-build time.
    git ls-remote --exit-code https://github.com/clankercode/lsp-openplanet "$(tr -d ' \n' <BINARY_REF)" >/dev/null \
      || { echo "❌ BINARY_REF ($(tr -d ' \n' <BINARY_REF)) does not resolve upstream"; exit 1; }
    echo "✅ Pre-release checks passed for v{{VERSION}}"
