# t5 — Per-root config layering (`.openplanet-lsp.toml`)

label: wayfinder:grilling · status: open · blocked-by: (none)

## Question

Config layering today: auto-detect < repo `.openplanet-lsp.toml` < user config <
`initializationOptions` (settings.ts contract), loaded once against THE root
(`LspConfig::load(Some(&path))`). With N plugin roots: per-plugin-root config files (each
plugin its own `game_target`/defines — matches Openplanet per-plugin model) vs one at the
opened root (simpler, global)? t1 inventory will confirm feasibility of per-root loads.
