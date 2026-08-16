# RELEASE.md — lsp-openplanet-ext release procedure

**Agents and humans: keep this file accurate.** If you change
`.github/workflows/release.yml`, version-bump scripts, `BINARY_REF`, the
VSIX build, or any step below, update this document in the **same
PR/commit**. Stale release docs are a bug.

This mirrors the release discipline of the server repo
(`clankercode/lsp-openplanet` → its `RELEASE.md`); this repo releases the
**VS Code extension + grammar**, wrapping the server binary at `BINARY_REF`.

---

## What a release produces

One git tag (`vX.Y.Z`) drives [`.github/workflows/release.yml`](.github/workflows/release.yml):

1. **Tag validation** — all workspace `package.json` versions must equal the
   tag's base version (`scripts/validate-release-tag.ts`; fails otherwise).
2. **Server binaries** — `build-binaries.yml` cross-builds `openplanet-lsp`
   at **`BINARY_REF`** (six platform targets) from the server repo.
3. **VSIX** — `packages/vscode-ext` is bundled (esbuild) and packaged with
   `vsce package`. Note: the VSIX is currently **platform-independent and
   does not bundle a binary** — users get the binary via `serverPath`,
   PATH, or (future) per-platform VSIXs. See _Known gaps_ below.
4. **GitHub Release** — created on the tag with:
   - release body extracted from `CHANGELOG.md` for this version
     (**must exist before tagging** — the extract step fails the release
     otherwise; dry-runs fall back to `[Unreleased]`),
   - the six platform binary archives (`.tar.gz`/`.zip`),
   - the `.vsix`,
   - a `SHA256SUMS` covering all assets.
5. **Publish fan-out** (skipped for `-dry` tags) — `publish-npm`,
   `publish-vsce`, `publish-ovsx`, each a secrets-gated stub today.

Dry run: tag `vX.Y.Z-dry` → everything except the publish fan-out, release
marked prerelease.

---

## Release procedure (agents follow exactly)

### 0. Preconditions

- [ ] `master` clean, all tests green: `just ci` (lint, format, typecheck,
      build, test, pkg-shape, ci-parity, workflow-lint)
- [ ] Decide the new version `X.Y.Z` (semver).
- [ ] Decide whether `BINARY_REF` should move (it pins the server version
      the release binaries are built from; currently `v0.5.0`). If the
      server repo cut a new release and the extension should carry it,
      update `BINARY_REF` in the same release commit.
- [ ] Previous tag for the changelog range: `git describe --tags --abbrev=0`

### 1. Bump versions

```bash
just bump X.Y.Z        # scripts/bump-version.ts — every workspace package.json
```

### 2. Write the CHANGELOG section (required BEFORE tagging)

Add a `## [X.Y.Z] - YYYY-MM-DD` section at the top of `CHANGELOG.md`
(under `## [Unreleased]`). CI extracts this section verbatim as the
GitHub Release body; **if the section is missing the release fails at the
extract step** — this is the enforcement that releases ship with notes.

Gather notes from real history, don't invent them:

```bash
PREV=$(git describe --tags --abbrev=0)
git log --oneline ${PREV}..HEAD
```

Group by Added / Fixed / Changed. Mention: grammar changes, extension
settings/behavior, packaging changes, and the server version at
`BINARY_REF` when it moved (users care which LSP they'll run).

Sanity-check extraction locally:

```bash
just extract-changelog X.Y.Z
```

### 3. Commit + tag + push

```bash
git add -A
git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin master vX.Y.Z
```

The tag push starts `release.yml`.

### 4. Watch CI to green

```bash
gh run list --workflow=release.yml --limit 3
gh run watch
```

If it fails: fix forward on master. Prefer a new patch tag over moving a
pushed tag; never force-push tags.

### 5. Post-CI (mandatory)

The release body CI wrote is the CHANGELOG section — verify it, don't
rewrite from scratch:

```bash
gh release view vX.Y.Z
gh release view vX.Y.Z --json assets --jq '.assets[].name'
# expect: 6 binary archives + the .vsix + SHA256SUMS
```

If the changelog needed post-tag fixes, update both `CHANGELOG.md`
(commit on master) and the release body:

```bash
just extract-changelog X.Y.Z > /tmp/body.md
gh release edit vX.Y.Z --notes-file /tmp/body.md
```

### 6. Done checklist

- [ ] `release.yml` green for the tag
- [ ] Release has all 6 binaries + VSIX + SHA256SUMS
- [ ] Release body = real changelog section (not stub)
- [ ] `CHANGELOG.md` committed section matches
- [ ] Publish stubs behaved as expected (no-op without secrets, or
      published if configured)
- [ ] `BINARY_REF` documents the server version this release carries
- [ ] This file still matches reality

---

## Version lockstep (enforced by CI)

| Source                          | Must equal                 |
| ------------------------------- | -------------------------- |
| git tag                         | `vX.Y.Z` (or `vX.Y.Z-dry`) |
| root `package.json`             | `X.Y.Z`                    |
| every `packages/*/package.json` | `X.Y.Z`                    |

`BINARY_REF` does **not** participate in lockstep (it may lag or lead the
extension version); it pins the _server_ build. Update it deliberately.

## Known gaps (as of 2026-08-17)

- The VSIX bundles no binary; per-platform VSIXs (or a postinstall
  resolver) are the open design decision — tracked in
  `docs/internal/review-2026-08-17-vscode-ext.md`.
- `publish-npm` / `publish-vsce` / `publish-ovsx` are secrets-gated stubs;
  marketplace/OVSX publishing is not yet configured.

## Layout (keep in sync)

```
BINARY_REF                 # server git ref the binaries build from
CHANGELOG.md               # user-facing history (required per release)
RELEASE.md                 # this file
scripts/
  bump-version.ts          # bump all workspace package.json versions
  validate-release-tag.ts  # tag ↔ versions lockstep (CI-enforced)
  extract-changelog.ts     # CHANGELOG section → release body (CI-enforced)
.github/workflows/
  ci.yml                   # PR/master CI
  release.yml              # tag → validate → build → VSIX → GH Release
  build-binaries.yml       # cross-build server at BINARY_REF (6 targets)
  publish-npm.yml / publish-vsce.yml / publish-ovsx.yml   # gated stubs
```

## Agent responsibilities (summary)

1. `just ci` green first; never tag red.
2. `just bump X.Y.Z` + write the real CHANGELOG section + move `BINARY_REF`
   if intended — **before** tagging.
3. Tag `vX.Y.Z`, push, watch `release.yml` to green.
4. Verify release assets (VSIX present) and body; fix forward if not.
5. Update this file in the same change whenever the procedure changes.
