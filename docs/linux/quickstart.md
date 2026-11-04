---
title: "crewrota quickstart for Linux (beta)"
description: "Install Claude Code, Node.js and crewrota on Linux, add your crew members, share history on a ship and start Claude. Linux support is beta."
sidebar:
  order: 3
  label: "Linux (beta)"
---

> **Beta:** crewrota on Linux is beta. The test suite passes in CI on Ubuntu (`.github/workflows/ci.yml`), but crewrota has not yet been tested thoroughly by hand on Linux. Windows is the main platform; see [Platforms and versions](../platforms.md).

Steps 1 to 5 give you a working crew: install Claude Code, Node.js and crewrota (`npm install -g crewrota`), add your members with `crew add <member>`, then start Claude with `crew`.
Step 6 adds what backups need (`libarchive-tools` on Debian and Ubuntu).
The rest is optional, and the last section lists what is Windows-only today.
Run the commands in your shell.

## 1. Install Claude Code

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

Then open a new shell and check it with `claude --version`.

## 2. Install Node.js 22.19 or newer

Install it from https://nodejs.org, then open a new shell and check it with `node --version`.

## 3. Install crewrota

```sh
npm install -g crewrota
```

`crew`, `crw` and `crewrota` are then known commands, all the same command.
Run it again to update. Remove it with `npm uninstall --global crewrota`.
Check the setup with `crew doctor`; when something is missing, its `fix:` lines give the Linux command.

From source: in the crewrota folder:

```sh
sh scripts/install.sh
```

It checks for Node 22, builds crewrota, packs it the way it would be published, and installs that package globally.

## Where crewrota keeps things on Linux

| What | Where |
|---|---|
| Members | `~/.crewrota/members/<member>` |
| Ships | `~/.crewrota/ships/<ship>` |
| Removed members and ships | `~/.crewrota/removed` |
| Settings | `~/.config/crewrota/config.json`, or `$XDG_CONFIG_HOME/crewrota/config.json` when `XDG_CONFIG_HOME` is an absolute path |

Set `CREWROTA_HOME` to keep members and ships somewhere else.
A member on a ship links its folders to the ship with symlinks.
Paths are matched case-sensitively, so `~/Code` and `~/code` are two different projects.

## 4. Add your crew members

```sh
crew add main
```

crew makes the folder `~/.crewrota/members/main` and starts Claude Code inside it, so you sign in with Claude Code's own login in your browser.
Paste the code if it asks for one, and type `/exit` once you see Claude's prompt.
Your main `~/.claude` login is not touched.
Then crew shows the email and organisation it logged in as, and asks whether to share history with other members.
Add as many members as you have accounts, for example `crew add side`.
More in [Add and manage crew members](../guides/members.md).

## 5. Share history, then start Claude

```sh
crew ship join main home
crew ship join side home
crew
```

The menu shows your members with their 5-hour and weekly bars, and the ship, model and effort below them.
Up and down (or 1 to 9) pick the member, tab picks the setting, left and right change it, enter starts, esc quits.
Each time the menu opens it reads every member's usage with quota-axi and sends no message.
`crew warmup` sends each member one short Haiku message, which starts its 5-hour window if none is running. It is the only crewrota command that sends a message.
Or skip the menu with `crew main`; Claude's own flags go after `--`, as in `crew main -- --resume <id>`.
At your first launch crewrota asks once whether sessions should start with `--dangerously-skip-permissions` (default no).

## 6. Install bsdtar for backups

`crew backup` and `crew restore` write and read a zip with bsdtar.
crewrota uses `bsdtar`, or a `tar` whose `--version` names bsdtar; GNU tar, the usual `tar` on Linux, cannot write the zip.
On Debian and Ubuntu, bsdtar comes in `libarchive-tools`, which is what CI installs:

```sh
sudo apt-get install -y libarchive-tools
```

Without it, a backup stops with:

```text
crewrota: crewrota needs bsdtar to write and read a backup zip (on Linux, install libarchive-tools).
```

`CREWROTA_TAR` points crewrota at a bsdtar somewhere else.
`crew backup --dry-run` needs no bsdtar, since it writes nothing.
More in [Move your crew to a new machine](../guides/backup-and-restore.md).

## 7. Install the default tools and the plugin (optional)

```sh
crew setup
```

It lists each tool with the exact command it runs, then asks once; treehouse installs with `curl -fsSL https://kunchenguid.github.io/treehouse/install.sh | sh` on Linux.
Then add the plugin in your main Claude Code:

```sh
claude plugin marketplace add pasindu-premachandra/crewrota
claude plugin install crewrota@crewrota
```

## What works differently on Linux

### The desktop widget

```sh
crew widget
```

crewrota starts the widget with `python3` from your PATH (or the Python in `CREWROTA_PYTHON`), and the widget needs Python's Tk module.
Check for it with `python3 -c "import tkinter"`; if that fails, install your distribution's Tk package for Python.
crewrota checks only that Python is found: with Tk missing it still prints `[OK] The widget is open...`, but no window appears.
The widget has not been opened on Linux by hand yet.
Opening it at login is Windows-only: `crew widget startup on` stops with `Opening the widget at login is Windows-only for now; macOS gets a menu bar item later.`
More in [Keep usage on your desktop with the widget](../guides/widget.md).

### VS Code shortcuts

```sh
crew shortcut add site --member main --folder ~/code/site
```

On Linux a shortcut is only the workspace file under `~/.crewrota/shortcuts`; its task runs `crew <member>` in your `$SHELL` (or `/bin/sh`).
There is no Start Menu entry or hotkey: `add` prints `The Start Menu entry and the hotkey are Windows-only for now.`, and a `--hotkey` you pass is saved but not used.
`crew shortcut open site` needs the `code` command on your PATH.
More in [Open a folder as a member from VS Code](../guides/vscode-shortcuts.md).

### No menu bar item

The menu bar plugin is for SwiftBar and xbar on macOS.
`crew quota --format menubar` still prints its text, if your own bar tool can read that format.

## Next

- [Your first crew in five minutes](../first-crew.md)
- [Fix a problem with crew doctor](../guides/troubleshooting.md)
- [Every command](../commands.md)
