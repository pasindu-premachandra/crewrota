---
title: "Members, ships and your main setup"
description: "The model behind crewrota: a member is a Claude Code config folder with one login, a ship is the shared history folders, and your main ~/.claude is linked into every member."
sidebar:
  order: 1
---

A crew member is a Claude Code config folder with one login in it; crewrota starts Claude Code with `CLAUDE_CONFIG_DIR` set to that folder.
A ship is a folder of shared history that several members link to.
Your main `~/.claude` stays yours: every member links to its skills, agents, commands and plugins, and gets a copy of its settings, but crewrota never writes to it.

## The picture

```text
~/.claude/                          your main setup, read only for crewrota
  skills/ agents/ commands/
  plugins/  settings.json  CLAUDE.md

~/.crewrota/                        the crew home
  members/
    main/                           CLAUDE_CONFIG_DIR when main runs
      .claude.json                  main's login details and identity
      quota.json                    main's last usage reading
      skills/ agents/ commands/     -> links to ~/.claude/<name>
      plugins/                      cache, data, marketplaces -> links to ~/.claude/plugins/<name>
      settings.json  CLAUDE.md      copies of ~/.claude/<name>, made at each launch
      projects/ todos/ file-history/ session-env/ shell-snapshots/
                                    -> links to ships/home/<name>
    side/                           the same layout, its own login
  ships/
    home/
      projects/ todos/ file-history/ session-env/ shell-snapshots/
      mcp.json                      the ship's MCP servers, with their keys
  shortcuts/                        VS Code workspace files
  removed/                          dropped members and deleted ships
```

On Windows the crew home is `%USERPROFILE%\.crewrota` and links are junctions; elsewhere they are symlinks.
`CREWROTA_HOME` moves the crew home.
The settings file, `config.json`, lives apart from the crew home: `%APPDATA%\crewrota\` on Windows, `~/.config/crewrota/` elsewhere.

## A member

A member is a folder under `members/` and an entry in `config.json`.
The folder is a full Claude Code config folder: Claude Code keeps the member's login, its `.claude.json` and its sessions there.
The entry holds the member's ship, model and effort.

- Its login is its own. Claude Code's login writes it there, and crewrota never copies or moves it.
- Its identity (email and organisation) is read from `oauthAccount` in its `.claude.json`.
- Its usage reading is `quota.json`.

See [Add and manage crew members](../guides/members.md).

## A ship

A ship is a folder under `ships/` with the five folders Claude Code keeps a session's history in, `projects`, `todos`, `file-history`, `session-env` and `shell-snapshots`, plus an `mcp.json`.
`projects` holds the session transcripts, one folder per project path.

A member on a ship has those five folders as links to the ship's.
Every member on the ship reads and writes the same files, so a session one member starts, another can resume.
A member on no ship is `isolated`: the five are its own folders.

The ship's `mcp.json` lists its MCP servers, and each member gets that list at launch.

See [Share history between members with a ship](../guides/ships.md).

## Your main setup

Everything you install in your main Claude Code reaches every member:

- `skills`, `agents`, `commands`, and the plugin `cache`, `data` and `marketplaces`, are links, so a change shows at once.
- `settings.json`, `CLAUDE.md` and the plugin lists are copied at every launch.

See [Use your main setup in every member](../guides/main-setup.md).

## What crewrota never does

- Never copies or moves a login; to read usage, quota-axi uses each member's own sign-in on your machine.
- Never writes to `~/.claude.json`, and writes to `~/.claude` only in `crew restore`, adding files without overwriting.
- Never deletes a member or a ship: `crew drop` and `crew ship delete` remove the links first, then move the folder to `removed/`.
- Never writes through a link.

## Related

- [What happens when a member launches](launch.md)
- [Files and folders](../reference/files-and-folders.md)
