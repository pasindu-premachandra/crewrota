---
title: "crewrota architecture: the source map"
description: "How the crewrota source is laid out: what each module in src/ does, the rule that only claude.ts runs Claude Code and quota-axi, and where the plugin, widget and templates live."
sidebar:
  order: 1
  label: "Architecture"
---

crewrota is a Node/TypeScript CLI with no CLI framework: `src/cli.ts` parses the arguments by hand and calls one module per area.
Every call to Claude Code and to quota-axi goes through `src/claude.ts`, which is what lets the tests swap both for fakes.
The npm package ships `dist/` (without the tests), `templates/`, `widget/` and `NOTICE`; the Claude Code plugin is installed from the GitHub repo, not from npm.

## The repo

```text
src/               the CLI, in TypeScript; built to dist/
src/test/          node:test tests; fixtures/ holds the fake claude and the fake quota-axi
plugin/            the Claude Code plugin: .claude-plugin/plugin.json, skills/firstmate/, hooks/
.claude-plugin/    marketplace.json: one plugin, crewrota, from ./plugin
templates/dot-claude/   the root .claude/ that crew init writes
widget/            crewrota-widget.pyw (the quota widget, Python with Tk) and crewrota.1m.sh (the SwiftBar and xbar plugin)
scripts/           install.ps1 and install.sh, check-private.mjs, hooks/pre-push
docs/              these docs, as plain Markdown
.github/workflows/ ci.yml
```

## The modules

| Module | What it does |
|---|---|
| `src/cli.ts` | Argument parsing and every command; the help text; the exit code |
| `src/members.ts` | The creation workflow (`crew add`), `use`, `rename`, `drop` |
| `src/menu.ts` | The one-screen crew menu (@clack/core), the `crew quota` and menubar lines, and the @clack/prompts questions |
| `src/launch.ts` | Builds the Claude argument list, repairs links, starts Claude in the member folder |
| `src/ships.ts` | Ships: create, join, leave, rename, import, the ship's `mcp.json` |
| `src/backup.ts` | `crew backup` and `crew restore`: one zip through bsdtar, the project folder renames, the tar runner |
| `src/context.ts` | What a backup carries beyond the ships: finds project `.claude` folders and repos from transcripts, copies with links resolved, the key check, folder mapping, clone |
| `src/progress.ts` | The one-line progress bar on stderr, shown only on a terminal and not when `CI=true` |
| `src/shared.ts` | Shared items from the main `~/.claude`: links, copies, plugin lists, `mcpServers` |
| `src/links.ts` | Link helpers (junctions on Windows), folder moves to `removed/`, session file counts |
| `src/rows.ts` | Member rows for the menu and `crew list`; reads `quota.json` |
| `src/statusline.ts` | `crew statusline`: writes `quota.json` and prints the line; gives a member the status line at launch |
| `src/shortcuts.ts` | `crew shortcut`: VS Code workspace files, the Start Menu `.lnk`, the VS Code and shell lookup |
| `src/widget.ts` | `crew widget`: starts the `.pyw` with Python, closes it through `widget.close`, the Startup shortcut |
| `src/say.ts` | The site palette (24-bit colour, named-colour fallback, plain when piped) and the `[i]`, `[!]` and `[OK]` tags |
| `src/identity.ts` | Email and organisation from a member's `.claude.json` |
| `src/claude.ts` | The only place that runs `claude` and quota-axi |
| `src/doctor.ts` | `crew doctor`: the setup checks with per-OS fix lines |
| `src/setup.ts` | `crew setup`: the default tools, one list, one yes, an injectable runner; the doctor's tool lines |
| `src/init.ts` | `crew init`: copies `templates/dot-claude/` without overwriting |
| `src/config.ts` | `config.json`: load, save, the remembered model and effort |
| `src/paths.ts` | Config, crew home, member, ship and main-setup paths |
| `src/names.ts` | The name rule for members, ships and shortcuts |

## Only claude.ts runs Claude Code and quota-axi

`src/claude.ts` holds every call:

- `claude --version` (with a `cmd.exe` fallback for an npm shim on Windows), `claude auth status --json`, `claude auth login`, `claude auth logout`, plain `claude` for a first login, and the session launch;
- the warm-up print run (`probeRateLimits`), the one place a message is sent;
- quota-axi, started with Node from `node_modules` with `--provider claude --json`, never through npx.

Each sets `CLAUDE_CONFIG_DIR` to the member folder.
`CREWROTA_CLAUDE` and `CREWROTA_QUOTA_AXI` replace the two programs, which is how the tests and the demo crews run without a real account.
Keep it this way: a new call to Claude Code goes into `claude.ts`, never a `spawn('claude', ...)` elsewhere.

## How a command flows

1. `main()` in `cli.ts` picks the command from the first argument. A first argument that is a member's name means `crew run <member>`.
2. The command parses its own flags with `parseArgs`: value flags take the next argument, any other `-x` is an unknown option, and `--` ends crewrota's arguments.
3. It loads `config.json`, does its work through the modules, saves the config, and returns an exit code.
4. A thrown `Error` becomes `crewrota: <message>` on stderr and exit code 1.
5. Commands that would ask a question call `needTerminal` first, which fails when stdin and stdout are not both a terminal.

## Dependencies

| Package | Version | Used for |
|---|---|---|
| `@clack/core` | 1.5.1, pinned | The one-screen menu |
| `@clack/prompts` | ^1.8.1 | Questions, notes, the hidden password prompt |
| `quota-axi` | 0.1.68, pinned | Reading each member's usage |

Development only: `typescript` ^7.0.2 and `@types/node` ^22.20.5.

## Related

- [Build and test](build-and-test.md)
- [Safety rules](safety-rules.md)
- [What happens when a member launches](../concepts/launch.md)
