---
title: "crewrota quickstart for macOS (beta)"
description: "Install Claude Code, Node.js and crewrota on a Mac, add your crew members, share history on a ship and start Claude. macOS support is beta."
sidebar:
  order: 2
  label: "macOS (beta)"
---

> **Beta:** crewrota on macOS is beta. The test suite passes in CI on macOS 15 (`.github/workflows/ci.yml`), but crewrota has not yet been tested thoroughly by hand on a Mac. Windows is the main platform; see [Platforms and versions](../platforms.md).

Steps 1 to 5 give you a working crew: install Claude Code, Node.js and crewrota (`npm install -g crewrota`), add your members with `crew add <member>`, then start Claude with `crew`.
Steps 6 to 8, the menu bar, the widget and the VS Code shortcuts are optional.
Run the commands in Terminal.

## 1. Install Claude Code

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

Or with Homebrew:

```sh
brew install --cask claude-code
```

Check it with `claude --version`.

## 2. Install Node.js 22.19 or newer

Download it from https://nodejs.org/en/download, then open a new Terminal window and check it with `node --version`.

## 3. Install crewrota

```sh
npm install -g crewrota
```

`crew`, `crw` and `crewrota` are then known commands in every terminal, all the same command.
Run it again to update. Remove it with `npm uninstall --global crewrota`.
Check the setup with `crew doctor`.

From source: in the crewrota folder:

```sh
sh scripts/install.sh
```

It checks for Node 22, builds crewrota, packs it the way it would be published, and installs that package globally.
Run the script again after pulling changes to update.

## 4. Add your crew members

```sh
crew add main
```

crew makes the folder `~/.crewrota/members/main` and starts Claude Code inside it, so you sign in with Claude Code's own login in your browser.
Paste the code if it asks for one, and type `/exit` once you see Claude's prompt.
Your main `~/.claude` login is not touched.
Then crew shows the email and organisation it logged in as, and asks whether to share history with other members: keep it isolated (the default), join an existing ship, or create a ship.
Every member gets your skills, agents, commands, plugins, settings and `CLAUDE.md` from `~/.claude`, and its MCP servers from its ship.
Add as many members as you have accounts, for example `crew add side`.
For single sign-on, use `crew add side --sso`.
More in [Add and manage crew members](../guides/members.md).

## 5. Share history, then start Claude

```sh
crew ship join main home
crew ship join side home
crew
```

The menu shows your members with their 5-hour and weekly bars, and the ship, model and effort below them.
Up and down (or 1 to 9) pick the member, tab picks the ship, the model or the effort, left and right change it, enter starts, esc quits; each member starts on its own ship and its last model and effort.
The bars show each member's last reading and fill after its first session. Each time the menu opens it reads them fresh with quota-axi, one call per member side by side, and sends no message; `crew config refresh off` stops that, and the bars then show each member's last reading.
`crew warmup` sends each member one short Haiku message, which starts its 5-hour window if none is running. It is the only crewrota command that sends a message.
Or skip the menu with `crew main` (short for `crew run main`).
Claude's own flags go after `--`: `crew main -- --resume <id>`.
At your first launch crewrota asks once whether sessions should start with `--dangerously-skip-permissions` (default no).
If something is missing, `crew doctor` says what and how to fix it.

## 6. Install the default tools and the plugin

```sh
crew setup
```

It lists each tool (the lavish, gh-axi and quota-axi skills, treehouse, Playwright CLI, and the Playwright MCP entry for each ship) with the exact command it runs and where it lands, then asks once.
Anything already installed is skipped.
It also asks whether lavish-axi may send usage telemetry, and checks `gh auth status` without signing you in.
`crew doctor` shows what is still missing.

Then add the plugin in your main Claude Code (not inside a member; members pick it up at their next launch):

```sh
claude plugin marketplace add pasindu-premachandra/crewrota
claude plugin install crewrota@crewrota
```

## 7. Set up a project and run firstmate

In the project's folder:

```sh
crew init
```

It writes `.claude/` (`crewrota.json`, a short `CLAUDE.md` if the project has none, `memories/`, `skills/`, `tasks/INDEX.md`) and never overwrites a file.
Then start Claude in that folder and hand it a task: `/firstmate <what you want done>`.

## 8. Moving to a new machine

Beta.
On the old machine:

```sh
crew backup --password
```

It writes one zip, for example `crewrota-backup-20261026-0905.zip`, with your ships, members, settings, skills and every project's `.claude` (tasks, evidence, memories), encrypted with the password you type twice. Add `--dry-run` first to see what goes in.
Logins are never in it.
The zip is written by bsdtar, which macOS already has.
Copy the zip to the new machine, install crewrota there (steps 1 to 3), then:

```sh
crew restore ./crewrota-backup-20261026-0905.zip --password
```

The restore renames your projects' session folders when your home folder differs; add `--map /Users/old/code=/Users/new/work` for projects that moved elsewhere, and `--clone` to fetch each repo's code from GitHub.
It ends with one `crew login <member>` line for each member; run each one to sign that member in again.
More in [Move your crew to a new machine](../guides/backup-and-restore.md).

## Menu bar (optional)

Beta.
crewrota ships one plugin file, `crewrota.1m.sh`, that puts every member's 5-hour and week use in the menu bar and refreshes it every minute.
It runs `crew quota --format menubar`, which only reads each member's last reading and never sends a message.

Install SwiftBar (macOS 12 or newer) and open it once; it asks you to pick its plugin folder:

```sh
brew install swiftbar
```

Copy the plugin file into that folder and make it executable (here the folder is `~/SwiftBar`):

```sh
cp "$(npm root --global)/crewrota/widget/crewrota.1m.sh" ~/SwiftBar/
chmod +x ~/SwiftBar/crewrota.1m.sh
```

The menu bar shows `crew` and the current member's 5-hour use, for example `crew 42%`.
Click it for each member's 5-hour and week use with their reset times, green under 60%, amber from 60% and red from 80%, then "Open the crew menu" and "Refresh".
xbar reads the same file from its own plugin folder.
More in [Show usage in the macOS menu bar](../guides/macos-menu-bar.md).

## Desktop widget (optional)

Beta.

```sh
crew widget                  # open it
crew widget close            # close it
```

The widget is a small always-on-top window with every member's 5-hour and week bars, the same as on Windows.
On a Mac crewrota starts it with `python3` from your PATH (or the Python in `CREWROTA_PYTHON`), so you need Python 3 with Tk.
It has not been opened on a Mac by hand yet.
Opening it at every login is Windows-only: `crew widget startup on` stops with `Opening the widget at login is Windows-only for now; macOS gets a menu bar item later.`
Use the menu bar plugin above for always-visible usage.
More in [Keep usage on your desktop with the widget](../guides/widget.md).

## VS Code shortcuts (optional)

```sh
crew shortcut add site --member main --folder ~/code/site
crew shortcut list
crew shortcut open site
```

A shortcut opens a folder in VS Code and runs `crew <member>` there as a task, in an editor tab; when the session ends, the tab stays open as a shell in that folder.
`add` writes `site.code-workspace` under `~/.crewrota/shortcuts`, and `open` starts it with the `code` command (in VS Code, run "Shell Command: Install 'code' command in PATH" once); VS Code brings back that window's layout and its other terminals each time, even when only that window was closed.
The Start Menu entry and the hotkey are Windows-only, so `add` prints `The Start Menu entry and the hotkey are Windows-only for now.`
Change one with `crew shortcut set`, remove one with `crew shortcut remove`; `crew rename` and `crew drop` carry a member's shortcuts along.
More in [Open a folder as a member from VS Code](../guides/vscode-shortcuts.md).

## Next

- [Your first crew in five minutes](../first-crew.md)
- [Fix a problem with crew doctor](../guides/troubleshooting.md)
- [Every command](../commands.md)
