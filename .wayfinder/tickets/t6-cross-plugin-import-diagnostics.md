# t6 — Cross-plugin isolation diagnostics

label: wayfinder:grilling · status: open · blocked-by: (none)

## Question

When plugin A's code imports/uses something only defined in sibling plugin B (visible in the
same editor window), what does the user see? Unresolved-silence (same as any unknown ident
today) vs an explicit diagnostic ("not visible across plugin workspaces")? Isolation must be
pinned by tests: cross-root import does NOT resolve; per-root `missing_required_dependencies`
stay per-root. Decide the diagnostic surface (probably: reuse existing unresolved-import
behavior; explicit cross-plugin error only if cheap).
