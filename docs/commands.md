---
title: "crewrota commands"
description: "Every crewrota command on one screen, each linked to its full reference with flags, defaults, output and exit codes."
sidebar:
  order: 0
  label: "All commands"
---

`crew`, `crw` and `crewrota` are the same command.
This page lists every command with one line on what it does; each command links to its reference, which has the flags, defaults, real output, exit codes and what needs a terminal.
`crew --help` prints the same list in your terminal.

## Start Claude as a member

| Command | What it does |
|---|---|
| [`crew`](reference/menu-and-run.md#crew-the-menu) | The menu: pick a member, its ship, a model and an effort on one screen, then start Claude Code as that member (needs a terminal) |
| [`crew run [<member>] [-- <claude args>]`](reference/menu-and-run.md#crew-run) | Start Claude as `<member>`, else `$CREW_MEMBER`, else the current member; arguments after `--` go to Claude |
| [`crew <member> [-- <claude args>]`](reference/menu-and-run.md#crew-member) | The same as `crew run <member>` |

## Members

| Command | What it does |
|---|---|
| [`crew add <member> [--ship <s>] [--email <e>] [--sso]`](reference/members.md#crew-add) | Create a member and log it in with Claude Code's own login (needs a terminal) |
| [`crew use <member>`](reference/members.md#crew-use) | Make `<member>` the current one; offers to create it if it does not exist |
| [`crew use -`](reference/members.md#crew-use) | Go back to the previous member |
| [`crew list`, `crew ls`](reference/members.md#crew-list) | Members with `*` on the current one, ship, last usage reading, email and organisation |
| [`crew whoami`](reference/members.md#crew-whoami) | The current member: folder, ship, email, organisation, logged in or not |
| [`crew current`](reference/members.md#crew-current) | The current member's name only; exit code 1 when there is none |
| [`crew login <member> [--email <e>] [--sso]`](reference/members.md#crew-login) | Log a member in again; its folder stays |
| [`crew logout <member>`](reference/members.md#crew-logout) | Log a member out; its folder stays |
| [`crew rename <old> <new>`](reference/members.md#crew-rename) | Rename a member; its shortcuts follow |
| [`crew drop <member> [--force] [--yes]`](reference/members.md#crew-drop) | Move a member's folder to `removed/`; `crew remove` is the same |

## Usage

| Command | What it does |
|---|---|
| [`crew quota`](reference/usage.md#crew-quota) | Every member's 5-hour and week use as bars, read fresh with quota-axi first unless `crew config refresh off` |
| [`crew quota --format menubar`](reference/usage.md#crew-quota---format-menubar) | The same as SwiftBar and xbar text, from each member's last reading; never checks usage |
| [`crew warmup [<member>...]`](reference/usage.md#crew-warmup) | Send each member (or the ones named) one short Haiku message, then show the bars; the only command that sends a message |
| [`crew widget`](reference/usage.md#crew-widget) | Open the quota widget, a small always-on-top window (needs Python 3 with Tk) |
| [`crew widget close`](reference/usage.md#crew-widget-close) | Close it |
| [`crew widget startup on\|off`](reference/usage.md#crew-widget-startup) | Open the widget at login, or stop that (Windows) |
| [`crew statusline`](reference/usage.md#crew-statusline) | The status line crewrota gives a member that has none: saves the session's usage to `quota.json` and prints one line |

## Ships

| Command | What it does |
|---|---|
| [`crew ship create <ship>`](reference/ship.md#crew-ship-create) | Make an empty ship: five shared folders and an `mcp.json` |
| [`crew ship list`](reference/ship.md#crew-ship-list) | Ships and their members |
| [`crew ship join <member> <ship>`](reference/ship.md#crew-ship-join) | Share `<member>`'s history through `<ship>`; what it had is copied in |
| [`crew ship leave <member>`](reference/ship.md#crew-ship-leave) | Make `<member>` isolated again; the ship keeps its files |
| [`crew ship rename <old> <new>`](reference/ship.md#crew-ship-rename) | Rename a ship; its members follow |
| [`crew ship delete <ship> [--force] [--yes]`](reference/ship.md#crew-ship-delete) | Move a ship's folder to `removed/` |
| [`crew ship import <ship> --from <folder>`](reference/ship.md#crew-ship-import) | Copy history and session folders from another folder into the ship; run it again to add what is new |
| [`crew ship mcp list <ship>`](reference/ship.md#crew-ship-mcp-list) | The ship's MCP servers, without their keys |
| [`crew ship mcp add <ship> <name> --url <url> [--transport <t>] [--header "Name: value"]...`](reference/ship.md#crew-ship-mcp-add) | Add a remote MCP server; `--transport` sets its type (`http` by default) |
| [`crew ship mcp add <ship> <name> [--env KEY=value]... -- <command> [args]`](reference/ship.md#crew-ship-mcp-add) | Add a local (stdio) MCP server |
| [`crew ship mcp add <ship> <name> --from <.claude.json>`](reference/ship.md#crew-ship-mcp-add) | Copy one server's definition from another config file |
| [`crew ship mcp remove <ship> <name>`](reference/ship.md#crew-ship-mcp-remove) | Remove one |

At every launch a member's own MCP server list (in its `.claude.json`) is replaced by its ship's list, or by the one in `~/.claude.json` when it is on no ship.
A server added inside a member with `claude mcp add --scope user` is gone at that member's next launch; add it to the ship instead.

## VS Code shortcuts

| Command | What it does |
|---|---|
| [`crew shortcut add <name> --member <m> [--folder <path>] [--hotkey <keys>]`](reference/shortcut.md#crew-shortcut-add) | A workspace file that opens the folder in VS Code and runs `crew <m>` there; on Windows also a Start Menu entry with an optional hotkey |
| [`crew shortcut list`](reference/shortcut.md#crew-shortcut-list) | The shortcuts with their member, folder and hotkey |
| [`crew shortcut set <name> [--member <m>] [--folder <path>] [--hotkey <keys>\|--no-hotkey]`](reference/shortcut.md#crew-shortcut-set) | Change only the given parts of a shortcut |
| [`crew shortcut remove <name>`](reference/shortcut.md#crew-shortcut-remove) | Delete a shortcut's workspace file and Start Menu entry |
| [`crew shortcut open <name>`](reference/shortcut.md#crew-shortcut-open) | Open a shortcut in VS Code |

## Backups

| Command | What it does |
|---|---|
| [`crew backup [--to <folder>] [--password] [--skip <folder>]... [--no-context] [--dry-run]`](reference/backup-and-restore.md#crew-backup) | One zip of every ship, the member list, the settings, your project `.claude` folders and your main skills; never a login |
| [`crew restore <zip> [--map <old>=<new>]... [--password] [--clone]`](reference/backup-and-restore.md#crew-restore) | Bring a backup back: ships merged, missing members made again, `.claude` folders and skills added, repos cloned with `--clone` |

## Settings

| Command | What it does |
|---|---|
| [`crew config permissions on\|off`](reference/config.md#crew-config-permissions) | Start sessions with `--dangerously-skip-permissions`, or not |
| [`crew config refresh on\|off`](reference/config.md#crew-config-refresh) | Read every member's usage with quota-axi as the menu and `crew quota` open; no message is sent (on by default) |
| [`crew config lavish on\|off`](reference/config.md#crew-config-lavish) | The plugin's Lavish rule at every session start (on by default) |
| [`crew config show`](reference/config.md#crew-config-show) | The remembered settings |

## Setup and checks

| Command | What it does |
|---|---|
| [`crew setup [--yes] [--with-hooks]`](reference/setup-init-doctor.md#crew-setup) | Install the default tools from upstream: one list, one yes; anything installed is skipped |
| [`crew init`](reference/setup-init-doctor.md#crew-init) | Write the project's root `.claude/` folder into the current folder; never overwrites a file |
| [`crew doctor [--logins]`](reference/setup-init-doctor.md#crew-doctor) | Check Node, Claude Code, the folders, every link and each default tool |
| `crew --help`, `crew -h`, `crew help` | The command list |
| `crew --version`, `crew -v` | The version number alone |

## Names

Member, ship and shortcut names use lowercase letters, digits and hyphens, start with a letter, and are at most 32 characters.

## Arguments for Claude

Anything after `--` goes to Claude Code, after crewrota's own flags.
A Claude flag before `--` fails: `crew main --resume abc` prints `crewrota: Unknown option: --resume`, while `crew main -- --resume abc` works.
See [The `--` rule](reference/menu-and-run.md#the----rule).

## Environment variables

`CREWROTA_HOME` moves the crew home, `CREW_MEMBER` picks the member for `crew run`, and `CREWROTA_BACKUP_PASSWORD` gives `--password` its value without a terminal.
`CREWROTA_CLAUDE`, `CREWROTA_QUOTA_AXI`, `CREWROTA_TAR`, `CREWROTA_CODE`, `CREWROTA_PYTHON`, `NO_COLOR` and `CI` are in [Environment variables](reference/environment-variables.md).

## Where things live

| What | Windows | macOS and Linux |
|---|---|---|
| Members | `%USERPROFILE%\.crewrota\members\<member>` | `~/.crewrota/members/<member>` |
| Ships | `%USERPROFILE%\.crewrota\ships\<ship>`: `projects`, `todos`, `file-history`, `session-env`, `shell-snapshots` and `mcp.json` | `~/.crewrota/ships/<ship>`, the same five folders and `mcp.json` |
| Shortcuts | `%USERPROFILE%\.crewrota\shortcuts` | `~/.crewrota/shortcuts` |
| Dropped members and deleted ships | `%USERPROFILE%\.crewrota\removed` | `~/.crewrota/removed` |
| Settings | `%APPDATA%\crewrota\config.json` | `~/.config/crewrota/config.json` (or `$XDG_CONFIG_HOME/crewrota`) |

Each member folder also holds its own `quota.json`, the last usage reading.
The full tree, with the widget's files and the folders kept aside when a member joins a ship, is in [Files and folders](reference/files-and-folders.md).
Set `CREWROTA_HOME` to keep members and ships somewhere else.
crewrota never deletes a member or a ship: `crew drop` and `crew ship delete` move the folder to `removed/`, and you delete it yourself when you are sure.

## More

- [Exit codes and terminal needs](reference/exit-codes.md)
- [The default tools](reference/setup-init-doctor.md#crew-setup)
- [The Claude Code plugin](agents/firstmate.md)
- [Move to a new machine](guides/backup-and-restore.md)
- [Your main setup in every member](guides/main-setup.md)
- [Questions people ask](faq.md)
