---
title: "crewrota files and folders"
description: "Where crewrota keeps everything on Windows, macOS and Linux: config.json, the crew home tree, member and ship folders, quota.json, a ship's mcp.json, the widget's files and a backup's manifest.json."
sidebar:
  order: 10
  label: "Files and folders"
---

crewrota keeps its settings in one `config.json` (`%APPDATA%\crewrota` on Windows, `~/.config/crewrota` elsewhere) and everything else in the crew home, `~/.crewrota` unless `CREWROTA_HOME` says otherwise.
Each member is a folder under `members/`, each ship a folder under `ships/`.
Your main `~/.claude` is only read, apart from what `crew restore` adds; `~/.claude.json` is only read.

## Where each thing is

| What | Windows | macOS and Linux |
|---|---|---|
| Settings | `%APPDATA%\crewrota\config.json` | `$XDG_CONFIG_HOME/crewrota/config.json` when that is an absolute path, else `~/.config/crewrota/config.json` |
| Crew home | `%USERPROFILE%\.crewrota` | `~/.crewrota` |
| A member | `<crew home>\members\<member>` | `<crew home>/members/<member>` |
| A ship | `<crew home>\ships\<ship>` | `<crew home>/ships/<ship>` |
| Shortcut workspace files | `<crew home>\shortcuts\<name>.code-workspace` | `<crew home>/shortcuts/<name>.code-workspace` |
| Shortcut Start Menu entries | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\<name>.lnk` | none |
| Widget at login | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\crewrota widget.lnk` | none |
| Dropped members, deleted ships | `<crew home>\removed` | `<crew home>/removed` |

## The crew home

```text
<crew home>/
  members/<member>/            the member's CLAUDE_CONFIG_DIR: its login, .claude.json, settings.json, quota.json
    projects  todos  file-history  session-env  shell-snapshots
                               links to its ship's folders when it is on one, else its own folders
    skills  agents  commands   links to ~/.claude/skills, agents, commands
    plugins/                   cache, data, marketplaces linked to ~/.claude/plugins;
                               installed_plugins.json, blocklist.json, install-counts-cache.json copied;
                               known_marketplaces.json copied with its paths pointed at this folder
    settings.json  CLAUDE.md   copied from ~/.claude at every launch
    <name>.before-crewrota-<yyyymmdd>
                               what the member had before it joined a ship or took your main plugins
  ships/<ship>/
    projects  todos  file-history  session-env  shell-snapshots
    mcp.json                   the ship's MCP servers, keys included
  shortcuts/<name>.code-workspace
  removed/<member>-<yyyymmdd-hhmm>/
  removed/ship-<ship>-<yyyymmdd-hhmm>/
  restore-<stamp>/             only while crew restore runs
  widget.pid  widget.close  widget.json
```

- Links are junctions on Windows and symbolic links on macOS and Linux.
- A member folder is made with mode 0700 and a ship's `mcp.json` with mode 0600, so on macOS and Linux only you can read them.
- `<folder>.incoming-<n><ext>` files appear where a join, an import or a restore found a file that differs from one already there.
- crewrota never deletes a member or a ship. It unlinks the links inside first, then moves the folder to `removed/`; you delete it yourself.

A member folder on a ship, after its first launch (from a demo crew):

```text
.claude.json
file-history -> /e/demo-crew-inventory/crew-home/ships/home/file-history/
projects -> /e/demo-crew-inventory/crew-home/ships/home/projects/
quota.json
session-env -> /e/demo-crew-inventory/crew-home/ships/home/session-env/
settings.json
shell-snapshots -> /e/demo-crew-inventory/crew-home/ships/home/shell-snapshots/
todos -> /e/demo-crew-inventory/crew-home/ships/home/todos/
```

## Inside a member folder

| File | Written by | What it holds |
|---|---|---|
| `.claude.json` | Claude Code; crewrota replaces only its `mcpServers` at every launch | The login's account (`oauthAccount`: email and organisation, which `crew list` shows) and Claude Code's own state |
| `settings.json` | copied from `~/.claude/settings.json` at every launch | Your main settings; when it has no `statusLine`, crewrota adds `crewrota statusline` |
| `CLAUDE.md` | copied from `~/.claude/CLAUDE.md` at every launch | Your main instructions |
| `quota.json` | `crew statusline`, the usage check, `crew warmup` | The last usage reading, below |

The login itself is Claude Code's own, kept in the member folder. crewrota never copies or moves a login; to read usage, quota-axi uses each member's own sign-in on your machine.

## quota.json

One per member folder, the last usage reading.

```text
$ cat ~/.crewrota/members/side/quota.json

{"ts":1793824758,"seen":1793824758,"five_hour_pct":12,"seven_day_pct":34,"five_hour_resets_at":1999990000,"seven_day_resets_at":1999999000}
```

| Key | What it is |
|---|---|
| `ts` | When the reading was written, in seconds since 1970 |
| `seen` | When the session behind it last wrote; a reading from an older session never overwrites a newer one |
| `five_hour_pct`, `seven_day_pct` | Percent used in the 5-hour and 7-day windows, or `""` when unknown |
| `five_hour_resets_at`, `seven_day_resets_at` | When each window resets, in seconds since 1970, or `""` |

- Written through `quota.json.tmp` and a rename, so a reader never sees half a file.
- A window missing from a new reading keeps its last value.
- Readers: the menu, `crew list`, `crew quota`, `crew quota --format menubar` and the widget. A window whose reset time has passed is shown as 0%.
- quota-axi's reading counts only when it is fresh; a member whose reading fails keeps its last one.

## A ship's mcp.json

```json
{
  "mcpServers": {
    "docs": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer EXAMPLE"
      }
    },
    "files": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@example/files-mcp",
        "E:/demo-crew-pages2/proj"
      ],
      "env": {
        "ROOT": "E:/demo-crew-pages2/proj"
      }
    }
  }
}
```

- A new ship starts with a copy of the `mcpServers` in your `~/.claude.json`.
- At every launch it replaces the `mcpServers` in each member's `.claude.json`. A member on no ship gets the list in `~/.claude.json`.
- It holds keys in plain text. Do not print it or paste it; `crew ship mcp list` shows it without them.
- A file that is not valid JSON stops the launch: `<file> is not valid JSON (<reason>). Nothing launched.`

## config.json

The settings: every key is in [crew config](config.md#keys-in-configjson).

## crewrota.json

Written by `crew init` into a project's `.claude/` folder: `{ "version": 1, "routing": [] }`.
It marks the project root for the `/firstmate` skill, and `routing` holds rules such as `{ "work": "docs and tests", "members": ["side", "team"] }`.
crewrota's own commands do not read it. See [firstmate](../agents/firstmate.md#pick-a-member-routing).

## A backup zip

```text
manifest.json
config.json
context/main/skills/<skill>/...
context/main/agents/  context/main/commands/  context/main/files/CLAUDE.md
context/roots/r<N>/.claude/...
context/roots/r<N>/CLAUDE.md
ships/<ship>/projects/  todos/  file-history/  session-env/  shell-snapshots/  mcp.json
```

`manifest.json` from a demo crew:

```json
{
  "format": 2,
  "crewrota": "1.0.4",
  "created": "2026-11-04T12:57:30.130Z",
  "platform": "win32",
  "home": "E:\\demo-crew-inventory\\home",
  "ships": [
    "home"
  ],
  "members": {
    "main": {
      "ship": "home",
      "model": "default",
      "effort": "default"
    },
    "side": {
      "model": "default",
      "effort": "default"
    }
  },
  "context": {
    "roots": [
      {
        "id": "r1",
        "path": "E:\\demo-crew-inventory\\proj\\site"
      }
    ],
    "repos": [],
    "skills": [
      "demo-skill"
    ],
    "plugins": []
  }
}
```

A backup with names outside plain ASCII also has `renamed`, which maps each `~crew<N>` entry back to its real name.
More in [crew backup](backup-and-restore.md#crew-backup).

## Widget files

| File | What it is |
|---|---|
| `widget.pid` | The widget's process id, while it is open |
| `widget.close` | Written by `crew widget close` to ask it to close |
| `widget.json` | Its position on screen |

## Related

- [Members, ships and your main setup](../concepts/members-and-ships.md)
- [Environment variables](environment-variables.md)
