# crewrota

crewrota runs Claude Code as one of your crew members.
A crew member is one Claude login with its own config folder, so each terminal can run a different account at the same time, and your main `~/.claude` login is never touched.
A ship is what several members share, as a ccs context group: conversation history and memory (so `--resume` in one member finds the sessions another member had), the session folders (todos, /rewind checkpoints, shell snapshots), and the ship's own MCP servers with their keys.

Type `crew` (or `crw`, or `crewrota`) and one screen shows each member with bars for its 5-hour and weekly usage, plus its ship, model and effort, remembered per member.
The bars come from a status line crewrota gives every member that has none of its own, so they fill after the member's first session.
That status line shows the model, the context used, the git branch, the 5-hour and week use, when the 5-hour window resets, the folder and the crew member.

Status: Pre-release. Private while it is tried for a week.

## Pick your OS

- Windows: [docs/windows/quickstart.md](docs/windows/quickstart.md)
- macOS (beta: not yet run on a real Mac): [docs/macos/quickstart.md](docs/macos/quickstart.md)

## Commands

`crw` and `crewrota` do exactly what `crew` does.

| Command | What it does |
|---|---|
| `crew` | Menu: pick a member (or add one), its ship, a model and an effort on one screen, then launch Claude Code as that member |
| `crew use <member>` | Make `<member>` the current one; if it does not exist, crew offers to create it |
| `crew use -` | Go back to the previous member |
| `crew add <member> [--ship <s>] [--email <e>] [--sso]` | Create a member and log it in with Claude Code's own login |
| `crew run [<member>] [-- <args>]` | Launch Claude as `<member>`, else `$CREW_MEMBER`, else the current member; arguments after `--` go to Claude |
| `crew <member> [-- <args>]` | The same as `crew run <member>`: the member's saved model, effort and ship |
| `crew list` or `crew ls` | Members with `*` on the current one, ship, usage, email and organisation |
| `crew whoami` | The current member: folder, ship, email, organisation, logged in or not |
| `crew statusline` | The status line crewrota gives members without one: saves the session's usage to `quota.json` and prints one line |
| `crew quota` | Every member's 5-hour and week use as bars, checked fresh first unless `crew config refresh off` |
| `crew widget` | Open the quota widget: every member's bars in a small always-on-top window (needs Python 3 with Tk) |
| `crew widget close` | Close it |
| `crew widget startup on\|off` | Open the widget at login, or stop that (Windows) |
| `crew current` | The current member's name only (exit code 1 when there is none) |
| `crew login <member>`, `crew logout <member>` | Log a member in or out again; its folder stays |
| `crew rename <old> <new>` | Rename a member |
| `crew drop <member> [--force] [--yes]` | Drop a member: its folder moves to `removed/` (refuses the current member unless `--force`); `crew remove` works too |
| `crew ship create <ship>` | Make an empty ship |
| `crew ship list` | Ships and their members |
| `crew ship rename <old> <new>` | Rename a ship; its members follow |
| `crew ship mcp list\|add\|remove <ship> ...` | The ship's MCP servers, which its members get at launch |
| `crew ship import <ship> --from <folder>` | Copy history, memory and session folders into the ship (a ccs context group folder works); run it again to add what is new |
| `crew ship delete <ship> [--force] [--yes]` | Move a ship's folder to `removed/` (refuses while members are aboard unless `--force`) |
| `crew ship join <member> <ship>` | Share `<member>`'s history through `<ship>`; its existing history is copied in |
| `crew ship leave <member>` | Make `<member>` isolated again; the ship keeps its files |
| `crew config permissions on\|off` | Start sessions with `--dangerously-skip-permissions`, or not |
| `crew config refresh on\|off` | Check every member's usage as the menu opens, with one short message each (on by default) |
| `crew config show` | Remembered settings |
| `crew doctor [--logins]` | Check Node, Claude Code, the folders and every link; `--logins` also asks Claude Code whether each member is logged in |
| `crew --help`, `crew --version` | Help and version |

Member and ship names use lowercase letters, digits and hyphens, start with a letter, and are at most 32 characters.

## Where things live

| What | Windows | macOS |
|---|---|---|
| Members | `%USERPROFILE%\.crewrota\members\<member>` | `~/.crewrota/members/<member>` |
| Ships | `%USERPROFILE%\.crewrota\ships\<ship>\projects` | `~/.crewrota/ships/<ship>/projects` |
| Removed members and ships | `%USERPROFILE%\.crewrota\removed` | `~/.crewrota/removed` |
| Remembered settings | `%APPDATA%\crewrota\config.json` | `~/.config/crewrota/config.json` |

Set `CREWROTA_HOME` to keep members and ships somewhere else.
crewrota never deletes a member or a ship: `remove` and `ship delete` move the folder to `removed/`, and you delete it yourself when you are sure.

## Your main setup in every member

Before every launch crew links each member's `skills`, `agents` and `commands` to the ones in `~/.claude`, gives it a `plugins` folder whose cache, data and marketplaces are links to yours (the layout ccs uses), and copies `~/.claude/settings.json` and `~/.claude/CLAUDE.md` into it.
It only reads your main setup; it never writes to `~/.claude` or `~/.claude.json`.

MCP servers come from the member's ship: `crew ship mcp list|add|remove <ship> ...` manages them, kept in that ship's `mcp.json` beside the logins, and a new ship starts with a copy of the ones in `~/.claude.json`.
A member with no ship gets the ones in `~/.claude.json`.
For servers that belong to one repo, use Claude Code's own `.mcp.json` in that repo (`claude mcp add --scope project`), with keys written as `${VAR}` and set in your shell before `crew`.

## Your accounts and Anthropic's terms

crewrota is for one person running their own Claude subscriptions.
Each member logs in through Claude Code's own login screen (plain `claude` in the member's folder, as ccs does; `claude auth login` only with `--email` or `--sso`), and Claude Code keeps that login inside the member's folder.
crewrota never reads, copies or ships credentials.
Read Anthropic's terms for your plan before you use several accounts:

- Consumer Terms: https://www.anthropic.com/legal/consumer-terms
- Claude Code legal and compliance: https://code.claude.com/docs/en/legal-and-compliance

## About --dangerously-skip-permissions

This Claude Code flag bypasses every permission check: the agent edits files and runs commands without asking you first.
crewrota asks once, at your first launch, whether to start sessions with it (the default answer is no), and remembers your answer.
Change it any time with `crew config permissions on` or `crew config permissions off`.
