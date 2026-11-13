---
title: "Use crewrota from an AI agent"
description: "How Claude Code, Codex, Cursor or any coding agent installs and drives crewrota for you: a setup prompt to paste, the commands it may run on its own, what only you can do, what it must never do, the files to read and two worked sessions."
sidebar:
  order: 0
  label: "Agent guide"
---

An agent can install crewrota, check it with `crew doctor`, read every member's usage and start a member headless with `crew run <member> -- -p "<prompt>" --output-format json`.
It cannot log a member in: `crew add` and `crew login` are Claude Code's own browser login, so the agent hands you the command and waits.
This page is written for both of you: paste the prompt below into your agent, and point it at this page for the rules.

## The setup prompt

Paste this into Claude Code, Codex, Cursor or another coding agent that can run shell commands:

```text
Install crewrota for me and check it. crewrota runs Claude Code as one of several
"crew members", each its own Claude login in its own folder. Docs for agents:
https://crewrota.pasindug.com/docs/agents/

1. Check that Node.js is 22.19 or newer (node --version) and that Claude Code
   runs (claude --version). If either is missing, stop and tell me how to install it.
2. Run: npm install -g crewrota
3. Run: crew --version, then crew doctor. Show me every FAIL line with the fix line
   under it. "miss" lines are optional tools and never a failure.
4. Run: crew setup (without --yes). It prints the tools it would install, then
   stops because it needs a terminal. Show me that list and ask me before you run
   crew setup --yes.
5. Do not run crew add, crew login or crew warmup yourself, and never read any
   .credentials.json, .env file or a ship's mcp.json. For each Claude account I
   want, give me the exact "crew add <name>" command to run in my own terminal.
```

When you have added your members, the agent can check them with `crew list` and `crew doctor --logins`.

### The Claude Code plugin

For `/firstmate` (one task handed to one or more members running headless), the plugin goes into your main Claude Code, not inside a member:

```sh
claude plugin marketplace add pasindu-premachandra/crewrota
claude plugin install crewrota@crewrota
```

Every member links your main plugin cache, so they all get it. See [firstmate](firstmate.md).

## What an agent may run on its own

These never ask a question and never send a message to Claude.

Reading only:

| Command | What it gives |
|---|---|
| `crew --version` | The version alone |
| `crew current` | The current member's name alone; exit code 1 when there is none |
| `crew list` | Each member with its ship, last reading, email and organisation |
| `crew whoami` | The current member in detail, logged in or not |
| `crew quota` | Every member's 5-hour and week use; it reads usage with quota-axi first, which sends no message, and saves each member's `quota.json` |
| `crew quota --format menubar` | The same from the saved readings, without checking usage |
| `crew config show` | The remembered settings, including whether the permissions question is answered |
| `crew ship list`, `crew ship mcp list <ship>` | Ships, their members and their MCP servers without keys |
| `crew shortcut list` | The VS Code shortcuts |
| `crew doctor`, `crew doctor --logins` | The setup checks; exit code 1 only on a `FAIL` |
| `crew backup --dry-run` | What a backup would hold, with warnings; writes nothing |

Changing things, when you asked for that change: `crew use <member>`, `crew init`, `crew ship create|join|leave|rename|import`, `crew ship mcp add|remove`, `crew shortcut add|set|remove`, `crew rename`, `crew config refresh on|off`, `crew config lavish on|off`, `crew backup` and `crew restore`.

## What needs your word first

| Command | Why |
|---|---|
| `crew run <member> -- ...` | It spends that member's quota, and runs without permission prompts when `crew config permissions on` is set |
| `crew warmup` | The only crewrota command that sends a message: one short Haiku message on every member named, or all of them |
| `crew config permissions on\|off` | It is your answer to whether Claude asks before it edits files and runs commands |
| `crew setup --yes` | It runs installers from the internet (`npx skills add`, PowerShell or `curl` scripts, `npm install -g`) |
| `crew drop <member> --yes`, `crew ship delete <ship> --yes` | They move a folder to `removed/` |
| `crew restore <zip> --clone` | It clones repos with your git login |
| the plugin install above | It changes your main Claude Code |

## What only you can do

| Step | Why the agent cannot | How the agent hands it over |
|---|---|---|
| `crew add <member>` | It runs Claude Code's own login in a browser, and refuses without a terminal | It prints the exact command; you run it in your own terminal and say when it is done |
| `crew login <member>` | The same login | The same |
| The permissions answer | It is a choice about safety, not a fact | It asks you "on or off?", then runs `crew config permissions on` or `off` with your answer |
| A backup password | A password typed into a chat or onto a command line is kept in the transcript and the shell history | You run `crew backup --password` (or `crew restore <zip> --password`) in your own terminal, or set `CREWROTA_BACKUP_PASSWORD` there yourself |

After you log members in, the agent can confirm with `crew doctor --logins`.

## What an agent must never do

- Read, copy or print any `.credentials.json`, any `.env` file, or the values in a ship's `mcp.json`. Use `crew ship mcp list <ship>`, which leaves keys out.
- Write to your main `~/.claude` or `~/.claude.json`. Only `crew restore` adds to `~/.claude`, by design.
- Delete a member or ship folder, or run a recursive delete inside one: they hold links to your ships and to `~/.claude`. Use `crew drop` and `crew ship delete`, which unlink first and move the folder to `removed/`.
- Run `crew warmup` or start `crew run` sessions you did not ask for.
- Put Claude flags before `--`: `crew main --resume abc` fails with `Unknown option: --resume`; `crew main -- --resume abc` works.
- Add an MCP server inside a member with `claude mcp add --scope user`: the member's list is replaced by its ship's at the next launch. Use `crew ship mcp add`.
- Run `lavish-axi share`, commit, push or merge without your word (the crewrota plugin's own rules).

## Read state from files, not from text

`crew list`, `crew quota`, `crew whoami`, `crew ship list` and `crew config show` print text for people and have no `--json`.
An agent reads the files instead:

| File | Where | What to read |
|---|---|---|
| `config.json` | `%APPDATA%\crewrota\config.json` on Windows, `~/.config/crewrota/config.json` elsewhere | `members` (names, `ship`, `model`, `effort`), `current`, `previous`, `skipPermissions` (`null` means not asked yet) |
| `quota.json` | `<crew home>/members/<member>/quota.json`, the crew home being `CREWROTA_HOME` or `~/.crewrota` | `five_hour_pct`, `seven_day_pct` (percent used), `five_hour_resets_at`, `seven_day_resets_at`, `fable_pct` and `fable_resets_at` (the weekly Fable figure, `""` when none) and `ts` (seconds since 1970) |
| a ship's `mcp.json` | `<crew home>/ships/<ship>/mcp.json` | Do not read it: it holds keys. `crew ship mcp list <ship>` gives the names and types |

A reading is old when `ts` is hours ago; a window whose `resets_at` has passed is back at 0%.
`crew quota` takes fresh readings for every member and saves them before it prints.
Every key is in [Files and folders](../reference/files-and-folders.md).

## Exit codes in one line

0 is success, 1 is an error with `crewrota: <message>` on stderr, and `crew run` passes on Claude Code's own exit code.
`crew current` exits with 1 when there is no current member, and `crew doctor` only on a `FAIL`.
Details and the list of commands that need a terminal: [Exit codes](../reference/exit-codes.md).

## Worked session: run a task on the member with room

You ask: "Fix the failing test in this repo on whichever crew member has room."

The agent first looks at the crew.

```text
$ crew list

*  main  isolated  5h 86%  7d 71%  (just now)  main@example.com (personal)
   side  isolated  5h 12%  7d 34%  (just now)  side@example.com (personal)
   team  isolated  5h 47%  7d 62%  (just now)  team@example.com (Example)

[exit code 0]
```

Three members, on three different accounts, so no two share one quota.
These are the last saved readings, so it takes fresh ones; `crew quota` sends no message.

```text
$ crew quota

crewrota  crew quota

     member   5h                       week
     main     ▖▖▖▖▖▖▖▖▖▖▖▖▖▖   86%     ▖▖▖▖▖▖▖▖▖▖▖▖▖▖   71%
     side     ▖▖▖▖▖▖▖▖▖▖▖▖▖▖   12%     ▖▖▖▖▖▖▖▖▖▖▖▖▖▖   34%
     team     ▖▖▖▖▖▖▖▖▖▖▖▖▖▖   47%     ▖▖▖▖▖▖▖▖▖▖▖▖▖▖   62%

[exit code 0]
```

`main` has used 86% of its 5-hour window; `side` has the most room on both windows.
The agent also checks it is not running on `side` itself: its own `CLAUDE_CONFIG_DIR` points at its own member folder.
For exact numbers it reads the file rather than the bars:

```text
$ cat ~/.crewrota/members/side/quota.json

{"ts":1793825306,"seen":1793825306,"five_hour_pct":12,"seven_day_pct":34,"five_hour_resets_at":1999990000,"seven_day_resets_at":1999999000}
```

A headless run cannot answer the one-time permissions question, so the agent checks it:

```text
$ crew config show

Config file: E:\demo-crew-pages2\w1\appdata\crewrota\config.json
Crew home: E:\demo-crew-pages2\w1\crew-home
--dangerously-skip-permissions: not asked yet
Usage check when the menu opens: off
Lavish rule at session start: on
Lavish telemetry: not asked yet (crew setup asks)
Last model: default, last effort: default
Current member: main, previous: none
  main: model default, effort default, isolated
  side: model default, effort default, isolated
  team: model default, effort default, isolated

[exit code 0]
```

`not asked yet`. A headless run cannot answer Claude Code's permission prompts, so a run that edits files needs `--dangerously-skip-permissions`.
That is your call, so the agent asks you, and tells you the run will then edit files and run commands without asking.
You say on:

```text
$ crew config permissions on

--dangerously-skip-permissions is on for every launch.

[exit code 0]
```

With your go-ahead to start the run, it starts `side` in the repo, with one short line pointing at a brief file it wrote, and Claude's JSON saved to a file:

```sh
cd ~/code/my-repo && crew run side -- -p "Read .claude/tasks/fix-test/brief.md and carry it out." --output-format json > run.json 2> run.err
```

When the run ends, the agent reads `run.json`.
Any `[i]` lines from crewrota come first; the line holding `"result"` is Claude Code's JSON, with `is_error`, `result`, `num_turns`, `duration_ms` and `session_id`.
An empty `run.json`, or `is_error` with "hit your session limit", means the member ran out: wait for the reset or pick the next member.
To follow up in the same session, it resumes it, Claude's flags after `--`:

```sh
crew run side -- -p "Also add a test for the empty case." --resume <session_id> --output-format json > run-2.json 2> run-2.err
```

Then it reads the diff itself before it tells you the test is fixed.

## Worked session: move a crew to a new computer

You ask: "I'm moving to a new laptop. Bring my crew over."

On the old machine the agent checks what a backup would hold, writing nothing:

```text
$ crew backup --dry-run

[i] 1 project .claude folders and 1 skills: 8 files, 1.1 KB
[i] Largest (leave one out with --skip <folder>):
      1.0 KB  E:\demo-crew-inventory\proj\site\.claude
    43 bytes  E:\demo-crew-inventory\home\.claude
    37 bytes  E:\demo-crew-inventory\proj\site\.claude\tasks\landing
[!] 1 files look like they hold a key (AWS key). Add --password to encrypt the backup:
  E:\demo-crew-inventory\proj\site\.claude\tasks\landing\evidence\notes.txt
[i] Dry run: nothing written.

[exit code 0]
```

A file looks like it holds a key, and the ships' MCP servers go in with their keys, so the backup should be encrypted.
A password is yours to type, so the agent does not invent one or put it on a command line.
If it tries `--password` itself, crewrota refuses:

```text
$ crew backup --password --to E:/demo-crew-inventory/out

crewrota: --password needs a terminal, or the password in CREWROTA_BACKUP_PASSWORD.

[exit code 1]
```

It hands you the command; you run `crew backup --password --to <folder>` in your own terminal, or set `CREWROTA_BACKUP_PASSWORD` there and let the agent run it.
The result:

```text
$ crew backup --to E:/demo-crew-inventory/out2 --password

[OK] Backup written: E:\demo-crew-inventory\out2\crewrota-backup-20261104-1827.zip
[i] 8.9 KB, 1 ship, 2 members, encrypted
[i] 1 project .claude folders and 1 skills: 8 files, 1.1 KB
[i] Largest (leave one out with --skip <folder>):
      1.0 KB  E:\demo-crew-inventory\proj\site\.claude
    43 bytes  E:\demo-crew-inventory\home\.claude
    37 bytes  E:\demo-crew-inventory\proj\site\.claude\tasks\landing
[i] No login is in it: after a restore, each member signs in again with crew login <member>.

[exit code 0]
```

You copy the zip to the new laptop yourself.
There the agent runs the setup prompt above, then the restore.
Your projects live in a different folder on the new machine, so it adds `--map` from the old folder to the new one; the old home folder maps to the new one on its own.
The password again comes from you.

```text
$ crew restore E:/demo-crew-inventory/out2/crewrota-backup-20261104-1827.zip --password --map E:\demo-crew-inventory\proj=E:\demo-crew-inventory\moved

[i] Project folders E--demo-crew-inventory-proj renamed to E--demo-crew-inventory-moved: 1
[i] Project folders E--demo-crew-inventory-home renamed to E--demo-crew-inventory-home2: 0
[OK] Ship home (new): 2 copied, 0 brought up to date, 0 already there, 0 kept beside a changed copy
[OK] Main setup (1 skills): 1 copied, 0 brought up to date, 0 already there, 0 kept beside a changed copy
[OK] Project .claude folders (1): 7 copied, 0 brought up to date, 0 already there, 0 kept beside a changed copy

[OK] Restored 1 ship and 2 members from E:/demo-crew-inventory/out2/crewrota-backup-20261104-1827.zip
[i] Logins are never in a backup. Sign each new member in:
  crew login main
  crew login side

[exit code 0]
```

The members are back without logins:

```text
$ crew list

   main  home      no reading yet  no login found
*  side  isolated  no reading yet  no login found

[exit code 0]
```

Logging in is yours, so the agent stops here and gives you the two lines to run in your terminal: `crew login main` and `crew login side`.
When you say they are done, it checks:

```sh
crew doctor --logins
```

Each member shows `ok    <member>: logged in`, and the crew is ready.
If the restore printed `Code not here yet: <folder> (<remote>). Add --clone to fetch it.`, the agent asks you before it runs the restore again with `--clone`, which clones with your git login.

## Docs an agent can fetch

Every docs page has a Markdown copy, and the whole set is in one file for agents; see [Docs for machines](machine-readable.md).
The repo itself carries an `AGENTS.md` for agents that work on crewrota's own code.

## Related

- [firstmate](firstmate.md)
- [Exit codes and terminal needs](../reference/exit-codes.md)
- [Your accounts and Anthropic's terms](../concepts/accounts-and-terms.md)
