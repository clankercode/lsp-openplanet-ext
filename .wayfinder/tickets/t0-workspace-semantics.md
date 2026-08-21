# t0 — Workspace semantics: one server, N isolated plugin workspaces

label: wayfinder:grilling · status: closed · resolved: 2026-08-18 (charting interview)

## Question

When a folder containing several plugin subdirs is opened, what are the workspace semantics —
combined workspace, isolated workspaces in one server, or one server per plugin?

## Resolution

**One server, N isolated plugin workspaces.** Each directory containing an `info.toml` is its
own workspace: own manifest, own dependency resolution, own diagnostics. No cross-plugin
import resolution or shared type context. Chosen because plugin worlds are independent in
Openplanet (deps resolve via installed plugins / `plugins_dir`, not sibling source trees),
and one server keeps client wiring simple.

Implication: every document (`.as`, `info.toml`) must map to the **nearest enclosing**
`info.toml` directory; server state keyed by plugin root, not by the single opened root.
