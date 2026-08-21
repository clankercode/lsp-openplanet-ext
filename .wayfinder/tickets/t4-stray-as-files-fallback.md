# t4 — Stray `.as` files outside any plugin root

label: wayfinder:grilling · status: open · blocked-by: (none)

## Question

`.as` files NOT under any `info.toml` dir (opened folder has no plugins, or mixed trees like
`dips++-all/dd2-server` beside plugin dirs): which workspace serves them? Options: a
degenerate root-level workspace (today's behavior preserved as fallback), none (no LSP
features), or nearest-plugin-root. Also: `untitled:` scheme documents (client selector
already includes them). Pick semantics + what tests pin them.
