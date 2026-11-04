---
title: "Share history between members with a ship"
description: "Create a ship, put members on it so they share history, memory and MCP servers, resume a session across members, and leave, rename, delete or import into a ship."
sidebar:
  order: 2
---

A ship is a set of folders that several members share: their session history, memory and session folders, plus one list of MCP servers.
Put a member on a ship with `crew ship join <member> <ship>`; members on the same ship can then `--resume` each other's sessions.
A member on no ship is `isolated` and sees only its own history.

## Create a ship and join it

```sh
crew ship create home
```

```text
Created ship home: E:\demo-crew-pages1\crew-home\ships\home\projects
```

```sh
crew ship join main home
```

```text
main shares history through ship home.
```

A ship holds five folders, `projects`, `todos`, `file-history`, `session-env` and `shell-snapshots`, plus an `mcp.json`.
Joining replaces those five folders in the member's folder with links to the ship's (junctions on Windows, symlinks elsewhere).
A new ship's `mcp.json` starts as a copy of the MCP servers in your main `~/.claude.json`.

### What happens to the member's own history

The member's history is never deleted.
When it already has its own `projects` folder (or another of the five with files in it), crew moves that folder aside to `<name>.before-crewrota-<date>` inside the member folder and copies its files into the ship:

```text
[i] Copied this member's history into the ship. The original folder is kept at E:\demo-crew-inventory\crew-home\members\main\projects.before-crewrota-20261104
main shares history through ship home.
```

A file whose name the ship already holds arrives beside it with `.incoming-1` before its extension (`<name>.incoming-1.jsonl`) instead of replacing it.
Once you have checked the ship, you can delete the `.before-crewrota-` folder yourself.

### Joining a ship that does not exist

`crew ship join` to a missing ship asks `Ship <ship> doesn't exist. Create it? (Y/n)`.
That needs a terminal; without one:

```text
crewrota: Ship crew2 doesn't exist. Creating it needs a terminal. Make it first with: crew ship create crew2
```

You can also pick a ship in the crew menu's settings line, or answer "Share history with other members?" when you add a member.

## Resume a session from another member

Claude Code files each session under the folder it was started in.
On a ship, every member reads and writes the same `projects` folder, so a session `main` started in a project shows up for `side` in that same project:

```sh
crew side -- --resume
```

Run it from the same project folder the session was started in.
Claude Code's flags, such as `--resume <id>` or `--continue`, go after `--`.

## List ships

```sh
crew ship list
```

```text
home: main, side
  E:\demo-crew-inventory\crew-home\ships\home\projects
```

With none: `No ships yet. Make one with: crew ship create <ship>`

## Leave a ship

```sh
crew ship leave side
```

```text
[i] side is isolated again. The ship's files stay in E:\demo-crew-inventory\crew-home\ships\home
```

Each link becomes an empty folder again, so the member starts with no history of its own.
The ship keeps every file, including the sessions this member added.

## Rename a ship

```sh
crew ship rename home base
```

```text
Renamed ship home to base.
```

The folder is renamed and every member on it is re-linked.
On Windows a running Claude session can block the move; close it and try again.

## Delete a ship

```sh
crew ship delete base --force --yes
```

```text
Folder: E:\demo-crew-inventory\crew-home\ships\base
Members linked: main (unlinked first; they become isolated)
Session files: 0
Deleted ship base. Its folder is kept at E:\demo-crew-inventory\crew-home\removed\ship-base-20261104-1826
```

Nothing is deleted: the folder moves to `removed/ship-<ship>-<date>-<time>` in your crew home.

- With members aboard and no `--force`, crew refuses: `Ship base still has members aboard: main. Run crew ship leave <member> for each first, or pass --force.`
- `--force` takes each member off the ship first; they become isolated.
- Without `--yes`, crew asks `Delete ship base? ...` (default no), which needs a terminal. Without one: `Confirming the deletion needs a terminal. Pass --yes to delete without asking.`

## Import history from another folder

If you kept Claude Code history somewhere else, copy it into a ship:

```sh
crew ship import home --from E:/demo-crew-inventory/ccs-group
```

```text
projects         1 copied, 0 brought up to date, 0 already there, 0 kept beside a changed copy
todos            0 copied, 0 brought up to date, 0 already there, 0 kept beside a changed copy
Imported into ship home. E:/demo-crew-inventory/ccs-group was only read.
```

crew looks for each of the five folders at `<from>/<name>` or `<from>/continuity/<name>`, so a Claude Code config folder works, as does another tool's shared-history folder in that layout.
The source is only read.
For each file:

- a new file is copied;
- the same file is left alone ("already there");
- a transcript that only grew in the source is brought up to date;
- a file that changed on both sides arrives beside the ship's copy with `.incoming-1` before its extension ("kept beside a changed copy").

Run it again any time to bring in what is new.
The ship must exist first (`Ship home doesn't exist. Make it first with: crew ship create home`), and a folder holding none of the five stops with `<folder> holds none of: projects, todos, file-history, session-env, shell-snapshots`.

## Related

- [Give a ship's members the same MCP servers](mcp-servers.md)
- [Ship commands, in full](../reference/ship.md)
- [Members, ships and your main setup](../concepts/members-and-ships.md)
- [Move your crew to a new machine](backup-and-restore.md)
