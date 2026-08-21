# t7 — Assemble the multi-root support spec

label: wayfinder:task · status: closed · resolved: 2026-08-21 (session w/ Hermes)

## Question

Assemble the locked decisions (t2 discovery, t4 stray files, t5 config, t6 isolation) plus
t1/t3 inventories into the final spec for "plugins in subdirs": server state model, document
→ plugin-root mapping, discovery flow, config layering, diagnostics scope, client wiring,
and the TDD test list (RED tests first). This ticket closing = the map's destination
reached; implementation planning happens after, outside wayfinder.

## Resolution

Spec written: `docs/superpowers/specs/2026-08-21-multi-root-plugin-workspaces.md`.
Decision table (t0/t2/t4/t5/t6/t8/t9), server state model (N×PluginWorkspace + global
typedb), URI→workspace routing, per-workspace rebuild/diagnostics fan-out, client wiring
(pluginRoots setting + watcher widening), 9-group TDD test list, 5 implementation phases.
