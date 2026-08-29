# Openplanet LSP for VS Code

Language support for [Openplanet](https://openplanet.dev) AngelScript plugins, powered by
[openplanet-lsp](https://github.com/clankercode/lsp-openplanet): diagnostics, completions,
hover, go-to-definition/references, rename, document/workspace symbols, signature help,
formatting, inlay hints, folding, call hierarchy, and semantic tokens.

## Requirements

The extension needs the `openplanet-lsp` binary. It is resolved in this order:

1. **`openplanetLsp.serverPath`** — absolute path you set explicitly.
2. **Bundled binary** — platform VSIX builds ship it in `bin/`.
3. **`openplanet-lsp` on your PATH** — e.g. `npm install -g openplanet-lsp`.

If none is found the extension shows an error with a shortcut to the settings; the log
channel (_Output → Openplanet LSP_) shows exactly what was tried.

## Settings

| Setting                         | Default       | Description                                        |
| ------------------------------- | ------------- | -------------------------------------------------- |
| `openplanetLsp.serverPath`      | `""`          | Absolute path to the binary override.              |
| `openplanetLsp.openplanetDir`   | `""`          | Openplanet install dir (auto-detected when empty). |
| `openplanetLsp.pluginsDir`      | `""`          | Plugins dir (auto-detected when empty).            |
| `openplanetLsp.gameTarget`      | `"TMNEXT"`    | Which game's `#if` platform branches are compiled. |
| `openplanetLsp.signatureMode`   | `"developer"` | Signature level whose `SIG_*` defines are live.    |
| `openplanetLsp.defines`         | `[]`          | Extra preprocessor defines (added, not replaced).  |
| `openplanetLsp.unused`          | `""`          | How unused declarations are reported.              |
| `openplanetLsp.inactiveRegions` | `""`          | Grey out `#if` branches your defines switch off.   |

**Precedence:** the server layers configuration as auto-detect → workspace
`.openplanet-lsp.toml` → user config → VS Code settings. The extension only forwards
settings you actually set (non-empty); anything left at its default is **not** sent, so a
repo's `.openplanet-lsp.toml` stays in control for your teammates.

`gameTarget` selects the preprocessor defines the LSP compiles with — set it to the game
your plugin targets so dead `#if MP4` / `#if TURBO` branches are treated as dead, exactly
like the real game does. Changing settings restarts the server automatically (they are
read at initialize time).

`signatureMode` does the same for the signature defines. Openplanet defines a signature
macro when the current level is equal or **below** that macro's level, so the levels are
cumulative — `official` gives `SIG_OFFICIAL`, `regular` adds `SIG_REGULAR`, `school` adds
`SIG_SCHOOL`, and `developer` (the default) gives all four. Narrow it to check your plugin
the way it compiles once signed: `#if SIG_DEVELOPER` blocks go dead below `developer`.

`defines` is **additive** — entries are added on top of what the game target and signature
level derive, plus `info.toml` `[script].defines`. Prefix an entry with `-` or `!` to turn
one off (`-LOGS`). A removal wins over an add of the same name wherever the two sit in the
list, so `["DEV", "-DEV"]` leaves `DEV` off. Names are **case sensitive**: `dev` and `DEV`
are two different defines, and nothing rewrites what you typed. You do not have to edit
the array by hand — see **Manage Defines** under [Commands](#commands).

`unused` sets how unused functions, variables, parameters and class members are reported:
`hint` (greyed out in the editor, kept out of the Problems panel), `info` (greyed out and
listed), `warn` (the server default), `error`, or `ignore` to turn the pass off. `hint` and
`info` never fail a `check`, not even under `--warnings-as-errors`. Every finding carries
the LSP `Unnecessary` tag at all levels, so the declaration is faded regardless of the
level you pick — VS Code gates that on `editor.showUnused`. Left empty, nothing is sent
and your `.openplanet-lsp.toml` decides.

`inactiveRegions` greys out `#if` branches that your current defines switch off, the way
an IDE fades `#if 0` in C — so you can see at a glance which code your `gameTarget` and
`signatureMode` have turned off. `hint` (the server default) fades without listing;
`info` also lists in the Problems panel; `ignore` marks nothing. There is deliberately no
warning/error level, and `openplanet-lsp check` never reports these at all — a branch
that is off for your target is dead by design, not a defect.

## Snippets

Typing `op` in a `.as` file offers the Openplanet boilerplate you would otherwise copy
from another plugin:

- **Callbacks** — `opmain`, `opupdate`, `oprender`, `oprenderearly`,
  `oprenderinterface`, `oprendermenu`, `oprendermenumain`, `oponenabled`,
  `opondisabled`, `opondestroyed`, `oponsettingschanged`, `oponkeypress`,
  `oponmousebutton`, `oponmousemove`, `oponmousewheel`. The three input callbacks also
  have `...blocking` variants that return `UI::InputBlocking` so you can swallow the
  input from the game.
- **Settings** — `opsetting` (plain) plus `opsettingname`, `opsettingdescription`,
  `opsettingcategory`, `opsettingrange` (slider), `opsettingdrag`, `opsettingcolor`,
  `opsettinghidden`, and `opsettingstab` for a `[SettingsTab]` you draw yourself.
- **Coroutines** — `opstartnew`, `opcoroutine`, `opyieldloop`, `opyielduntil`.

Every prefix starts with `op` on purpose: a bare `main` or `render` prefix would fire
while you are typing an ordinary identifier. Callback signatures come from the
[Openplanet callback reference](https://openplanet.dev/docs/reference/plugin-callbacks),
cited in the snippet file itself.

## Commands

All under the **Openplanet LSP** category in the command palette:

- **Restart Server** — restart the language server.
- **Restart Server with Verbose Logging** — same, but with `RUST_LOG=debug` in
  the server's environment. Use it to reproduce a problem for a bug report without
  editing any settings; a plain restart turns it back off.
- **Show Logs** — reveal the _Openplanet LSP_ output channel.
- **Show Status** — open a read-only document with the resolved server path and
  version, the type DB versions, your effective settings, and your workspace roots.
  Home directories are shown as `~`, and no environment variables are included, so
  it is safe to paste straight into an issue.
- **Manage Defines** — a checklist of your `openplanetLsp.defines` overrides. Checked
  means on; unchecking one writes the `-NAME` entry that turns it off. The whole
  checklist is saved in one write, so a session of toggling restarts the server once.
- **Add Define** — type a name to add. Prefix it with `-` to add an off entry instead.
  Adding a platform selector for a different game than your `gameTarget` (`MP4`
  while the target is `TMNEXT`) is flagged, because the server treats it as
  authoritative and drops the target's own selectors — every `#if TMNEXT` branch
  would go dead. The warning does not block you; same-generation names like
  `MP40` under `MP4` are not flagged at all.
- **Remove Define** — delete entries from the array. This is different from turning a
  define off: removing an entry means "no opinion", so whatever the game target,
  signature level and `info.toml` derive applies again.
- **Clear Define Overrides** — empty the array back to the derived set, behind a
  confirmation.

Each of these asks whether to write to **Workspace** or **User** settings when a folder
is open, defaulting to Workspace — a define override is almost always specific to one
plugin. With no folder open the question is skipped and User settings are used.

The manage checklist currently lists **your own override entries**, labelled
`user setting`. Showing the full resolved set — the defines the game target, signature
level, `info.toml` and your dependencies contribute, each labelled with where it came
from — needs the server to report them, which it does not do yet.

## Status bar

An indicator on the right shows whether the server is starting, ready, restarting,
or failed — the failed state is coloured with the editor's error background. Hover
it for the resolved binary, its version, the type DB versions and where they came
from, the active game target, and the workspace root of the file you are looking at
(which follows the active editor in a multi-root workspace). Click it to open the log.

The indicator is driven by the language client's own state events and two one-shot
probes taken when a server starts. It never polls.

## Untrusted workspaces

Functionality is limited in untrusted workspaces: the server reads workspace files, and
`openplanetLsp.serverPath` can point at any executable — review it before trusting.

## License

[Unlicense](https://unlicense.org) — same as openplanet-lsp.
