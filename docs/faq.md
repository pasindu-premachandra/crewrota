---
title: "crewrota FAQ"
description: "Short answers to what people ask about crewrota: several Claude Code accounts at once, logins, usage limits, sharing history, MCP servers, moving machines, headless runs and removing it."
sidebar:
  order: 99
  label: "FAQ"
---

Short answers, each with a link to the page that has the rest.
crewrota runs Claude Code as one of your crew members, each one Claude login in its own folder; the commands are `crew`, `crw` and `crewrota`.

## Can I use two Claude Code accounts at the same time?

Yes.
Each crew member is its own Claude Code config folder with its own login, so `crew main` in one terminal and `crew side` in another run as two accounts side by side.
Your main `~/.claude` login is never touched.
See [Add and manage crew members](guides/members.md), and read [Your accounts and Anthropic's terms](concepts/accounts-and-terms.md) before you use several accounts.

## Does crewrota read or store my Claude login?

crewrota never copies or moves a login; to read usage, quota-axi uses each member's own sign-in on your machine.
Each member logs in through Claude Code's own login (`crew add`, `crew login`), and the login stays in that member's folder.
A backup never holds a login: after `crew restore`, each member signs in again with `crew login <member>`.

## Which account is close to its usage limit?

`crew quota` shows every member's 5-hour and week use as bars, read fresh with quota-axi, which sends no message.
`crew list` shows the last reading for each member, and the crew menu shows the same bars before you pick.

```text
$ crew quota

crewrota  crew quota

     member   5h                       week
     main     ▖▖▖▖▖▖▖▖▖▖▖▖▖▖   86%     ▖▖▖▖▖▖▖▖▖▖▖▖▖▖   71%
     side     ▖▖▖▖▖▖▖▖▖▖▖▖▖▖   12%     ▖▖▖▖▖▖▖▖▖▖▖▖▖▖   34%
     team     ▖▖▖▖▖▖▖▖▖▖▖▖▖▖   47%     ▖▖▖▖▖▖▖▖▖▖▖▖▖▖   62%

[exit code 0]
```

See [Check every member's usage](guides/usage-and-quota.md).

## Does crewrota send messages on my accounts?

Only `crew warmup` does: one short Haiku message per member, which starts its 5-hour window if none is running.
The menu, `crew quota`, `crew list`, the widget and the status line only read usage.
See [Where usage readings come from](concepts/usage-readings.md).

## Can another account continue my Claude Code session?

Yes, when both members are on the same ship: a ship shares the `projects` folder where Claude Code keeps its history, so `crew side -- --resume <session id>` picks up a session `main` started.
Claude's own flags go after `--`.
See [Share history between members with a ship](guides/ships.md).

## Why is an MCP server I added gone after I restart?

At every launch crewrota replaces a member's own MCP list with its ship's, or with the one in `~/.claude.json` when the member is on no ship.
A server added inside a member with `claude mcp add --scope user` is lost at its next launch.
Add it to the ship with `crew ship mcp add <ship> <name> ...`, or to a repo's `.mcp.json` for one project.
See [Give a ship's members the same MCP servers](guides/mcp-servers.md).

## Why does `crew main --resume` say "Unknown option"?

crewrota reads every argument before `--` as its own.
Put Claude's flags after it: `crew main -- --resume <id>`.
See [The `--` rule](reference/menu-and-run.md#the----rule).

## How do I move Claude Code and my crew to a new computer?

`crew backup --password` on the old machine writes one zip with your ships (history, memory, MCP servers), the member list, the settings, your project `.claude` folders and your main skills.
`crew restore <zip> --password` on the new one merges it in, renaming project folders to the new paths; add `--map <old>=<new>` for folders that moved.
Then sign each member in with `crew login <member>`.
See [Move your crew to a new machine](guides/backup-and-restore.md).

## Can I run crewrota from a script or an AI agent?

Yes, once the one-time permissions question is answered (`crew config permissions on` or `off`): `crew run <member> -- -p "<prompt>" --output-format json` starts a member headless.
Only adding a member and logging one in need you at a terminal.
See the [AI agent guide](agents/index.md) and [Exit codes and terminal needs](reference/exit-codes.md).

## Does crewrota work on macOS and Linux?

Windows is the main platform.
macOS and Linux are beta: the test suite passes in CI on macOS 15 and Ubuntu, but they have not yet been tested thoroughly by hand.
On Linux, backups need `libarchive-tools` for bsdtar.
See [Platforms and versions](platforms.md).

## Where does crewrota keep its files?

Members and ships are in `~/.crewrota` (`%USERPROFILE%\.crewrota` on Windows), or `CREWROTA_HOME`; the settings are in `%APPDATA%\crewrota\config.json` on Windows and `~/.config/crewrota/config.json` elsewhere.
See [Files and folders](reference/files-and-folders.md).

## How do I uninstall crewrota?

`npm uninstall --global crewrota` removes the commands.
Your members and ships stay in the crew home and your settings in `config.json` until you delete those folders yourself; a member folder holds links to ships and to `~/.claude`, so remove the links first (`crew drop` and `crew ship delete` do that and move the folders to `removed/`).
See [Install crewrota](install.md#uninstall).

## Related

- [All commands](commands.md)
- [Fix a problem with crew doctor](guides/troubleshooting.md)
