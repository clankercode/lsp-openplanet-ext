# t6 — Cross-plugin isolation diagnostics

label: wayfinder:grilling · status: closed · resolved: 2026-08-21 (session w/ Hermes)

## Question

When plugin A's code imports/uses something only defined in sibling plugin B (visible in the
same editor window), what does the user see? Unresolved-silence (same as any unknown ident
today) vs an explicit diagnostic ("not visible across plugin workspaces")? Isolation must be
pinned by tests: cross-root import does NOT resolve; per-root `missing_required_dependencies`
stay per-root. Decide the diagnostic surface (probably: reuse existing unresolved-import
behavior; explicit cross-plugin error only if cheap).

## Resolution

**Cross-plugin resolution goes through the normal dependency contract — no new
diagnostic, no raw symbol bleed.**

1. **Installed plugins resolve as normal** (unchanged): the existing ladder
   (`resolve_dependency` over `plugins_dirs` = configured `plugins_dir` + auto-detected
   game Openplanet Plugins dir) stays primary. Sibling B installed in the game → A's
   `import` of it resolves exactly as today.
2. **Workspace-sibling fallback**: when normal resolution misses AND plugin A's manifest
   declares the sibling's **directory name** in `dependencies` or
   `optional_dependencies`, resolve the dep from the sibling plugin root in the opened
   folder. Mechanically: append the opened folder (parent of the plugin roots) as a
   **last-priority** `plugins_dir` entry — `plugins_dir.join(dep_id)` then hits the
   sibling dir, `resolve_directory_plugin` reads its `info.toml`, and only its **export
   files** load (deps.rs:118-132, collect_export_files). The sibling is treated exactly
   like an installed plugin: manifest contract, exports only, transitively walks the
   sibling's own `export_dependencies`. Optional deps stay optional (load when present,
   never error).
3. **Neither present** → existing unresolved-import silence (no new cross-plugin
   diagnostic); required-but-missing still fires the existing
   `missing_required_dependencies` diagnostics per-root.

Rationale: this is the same contract as the game runtime (A sees B only via declared deps +
exports), so workspace isolation (t0) is preserved — no symbol bleed, only declared export
files cross the boundary. Ordering matters: game/configured installs WIN over workspace
siblings (an installed newer copy beats the sibling source tree).
