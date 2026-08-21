# t5 — Per-root config layering (`.openplanet-lsp.toml`)

label: wayfinder:grilling · status: closed · resolved: 2026-08-21 (session w/ Hermes)

## Question

Config layering today: auto-detect < repo `.openplanet-lsp.toml` < user config <
`initializationOptions` (settings.ts contract), loaded once against THE root
(`LspConfig::load(Some(&path))`). With N plugin roots: per-plugin-root config files (each
plugin its own `game_target`/defines — matches Openplanet per-plugin model) vs one at the
opened root (simpler, global)? t1 inventory will confirm feasibility of per-root loads.

## Resolution

**Per-root layering with a parent-level base.**

1. **Ladder** (lowest→highest priority): auto-detect → **parent (opened-folder)
   `.openplanet-lsp.toml`** as a new lowest-priority workspace layer → **per-plugin-root
   `.openplanet-lsp.toml`** → user config (`~/.config/...`) → init options → per-root
   manifest defines. `LspConfig::load` gains a parent-layer input (pure fn — t1 confirmed
   per-root calls work unchanged today).
2. **Field split**: typedb stays **global in phase-1** — `game_target` and
   `openplanet_dir` are process-wide, resolved once as init options > user config >
   first-root config; documented as a known limit (rare: plugins wanting different games
   in one tree). Everything else — `defines`, ` plugins_dir`, `source_paths`,
   `ignore_paths` — is per-root.
3. Rejected: fully per-root typedb (per-workspace typedb sharding = real machinery,
   deferred); opened-folder-only config (plugins can't diverge).
