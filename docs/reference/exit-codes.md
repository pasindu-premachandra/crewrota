---
title: "crewrota exit codes and which commands need a terminal"
description: "What each crewrota exit code means, which commands pass on Claude Code's exit code, which commands need a terminal and what they print without one."
sidebar:
  order: 11
  label: "Exit codes"
---

Every crewrota command exits with 0 when it works and 1 when it fails, after printing `crewrota: <message>` on stderr.
`crew run`, `crew <member>`, `crew login` and `crew logout` exit with Claude Code's own exit code.
Commands that would ask a question fail with exit code 1 when stdin and stdout are not both a terminal, and say what to run instead.

## Exit codes

| Code | When |
|---|---|
| 0 | The command worked, or you cancelled a question (`Nothing launched.`, `Nothing created.`, `Nothing dropped.`, `Nothing deleted.`, `Nothing changed.`, `Nothing installed.`) |
| 1 | An error: crewrota printed `crewrota: <message>` on stderr |
| 1 | An unknown command: `Unknown command: <args>` and the help on stderr |
| 1 | A usage error: `crewrota: Usage: <the right form>` |
| 1 | A flag that is not known: `crewrota: Unknown option: <flag>`; a value flag with no value: `crewrota: <flag> needs a value.` |
| Claude's | `crew run`, `crew <member>`, `crew login`, `crew logout`: whatever Claude Code exits with; 1 when it cannot be started |

### Special cases

| Command | Exit code |
|---|---|
| `crew current` | 1 and no output when there is no current member |
| `crew doctor` | 1 only when a check that is not optional fails (`FAIL`); missing tools (`miss`) never fail it |
| `crew setup` | 1 when any install step did not finish |
| `crew widget close` | 1 when the widget is still open after 5 seconds |
| `crew statusline` | always 0 |

A failing `crew current`:

```text
$ crew current



[exit code 1]
```

`crew run` passing on Claude's exit code (the fake Claude in a demo crew exited with 7):

```text
$ crew run main


[exit code 7]
```

## What prints where

- Errors go to stderr as `crewrota: <message>`, in red on a terminal.
- Everything else goes to stdout, including the `[i]` notes before a launch, so they come before Claude's own output.
- Progress bars of `crew backup` and `crew restore` go to stderr, only on a terminal and not when `CI=true`.
- Piped output has no colour.

## Output a script can rely on

| Output | Form |
|---|---|
| `crew --version`, `crew -v` | The version alone, such as `1.0.4` |
| `crew current` | The name alone, or exit code 1 |
| `crew quota --format menubar` | SwiftBar and xbar lines; reads `quota.json` only |
| `crew run <member> -- -p "<prompt>" --output-format json` | Claude Code's JSON, after any `[i]` lines from crewrota |
| `config.json`, `quota.json`, a ship's `mcp.json`, a backup's `manifest.json` | JSON; see [Files and folders](files-and-folders.md) |

`crew list`, `crew quota`, `crew whoami`, `crew ship list` and `crew config show` are text for people; there is no `--json`.
Read the files instead.

## Commands that need a terminal

A terminal here means stdin and stdout are both a TTY.
Without one, these fail with exit code 1:

| Command | Message without a terminal | Instead |
|---|---|---|
| `crew` (the menu) | `The menu needs a terminal. Without one, use: crew run <member>` | `crew run <member>` |
| `crew add <member>` | `Adding a crew member needs a terminal. It runs Claude Code's own login.` | Run it yourself in a terminal |
| `crew use <member>` for a member that does not exist | `Crew member <member> doesn't exist. Creating it needs a terminal. Run crew add <member> in a terminal.` | `crew add` in a terminal |
| `crew ship join <member> <ship>` for a ship that does not exist | `Ship <ship> doesn't exist. Creating it needs a terminal. Make it first with: crew ship create <ship>` | `crew ship create <ship>` first |
| `crew drop <member>` without `--yes` | `Confirming the drop needs a terminal. Pass --yes to drop without asking.` | `--yes` |
| `crew ship delete <ship>` without `--yes` | `Confirming the deletion needs a terminal. Pass --yes to delete without asking.` | `--yes` |
| `crew setup` without `--yes`, when anything is missing | `crew setup asks once before it installs anything, and that needs a terminal. Run it in a terminal, or pass --yes to install without asking.` | `--yes`, once the person whose machine it is agrees |
| `crew backup --password`, `crew restore --password` | `--password needs a terminal, or the password in CREWROTA_BACKUP_PASSWORD.` | `CREWROTA_BACKUP_PASSWORD` |
| `crew run`, `crew <member>` before the permissions question is answered | `crewrota asks once whether to use --dangerously-skip-permissions, and that needs a terminal.` then `Answer it now with: crew config permissions on   (or off)` | `crew config permissions on` or `off` |

`crew login <member>` does not check for a terminal, but it hands the terminal to Claude Code's login, which needs a person.

## Commands that never ask

`crew --version`, `crew --help`, `crew list`, `crew ls`, `crew whoami`, `crew current`, `crew quota`, `crew quota --format menubar`, `crew warmup`, `crew widget`, `crew widget close`, `crew widget startup on|off`, `crew use` for an existing member, `crew use -`, `crew run` once permissions are answered, `crew rename`, `crew drop --yes`, every `crew shortcut` command, `crew ship create`, `list`, `rename`, `leave`, `import` and every `crew ship mcp` command, `crew ship join` to an existing ship, `crew ship delete --yes`, `crew backup` and `crew restore` (with `CREWROTA_BACKUP_PASSWORD` for `--password`), every `crew config` command, `crew setup --yes`, `crew init`, `crew doctor` and `crew statusline`.

## Related

- [AI agent guide](../agents/index.md)
- [Fix a problem with crew doctor](../guides/troubleshooting.md)
