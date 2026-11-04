---
title: "crewrota environment variables"
description: "Every environment variable crewrota reads or sets: CREWROTA_HOME, CREW_MEMBER, CREWROTA_BACKUP_PASSWORD, the CREWROTA_ overrides, NO_COLOR, CI and the ones it passes to Claude Code."
sidebar:
  order: 9
  label: "Environment variables"
---

`CREWROTA_HOME` moves the crew home (default `~/.crewrota`), `CREW_MEMBER` picks the member `crew run` starts, and `CREWROTA_BACKUP_PASSWORD` gives `crew backup --password` and `crew restore --password` their password without a terminal.
The other `CREWROTA_` variables point crewrota at another `claude`, quota-axi, tar, VS Code or Python.
crewrota sets `CLAUDE_CONFIG_DIR` to the member's folder for every Claude Code and quota-axi it starts.

## Variables you set

| Variable | Read by | Default | Effect |
|---|---|---|---|
| `CREWROTA_HOME` | every command, the firstmate board | `~/.crewrota` | The crew home: `members/`, `ships/`, `shortcuts/`, `removed/` and the widget's files |
| `CREW_MEMBER` | `crew run` | none | The member to start when you name none; the current member comes after it |
| `CREWROTA_BACKUP_PASSWORD` | `crew backup --password`, `crew restore --password` | none | The password, read only when there is no terminal. It is never printed or saved |
| `CREWROTA_CLAUDE` | every command that runs Claude Code | `claude` on PATH | Another `claude`. A `.js`, `.mjs` or `.cjs` file is run with Node; the tests point it at their fake |
| `CREWROTA_QUOTA_AXI` | the menu, `crew quota` | the quota-axi installed with crewrota | Another quota-axi, run with `--provider claude --json`. A `.js`, `.mjs` or `.cjs` file is run with Node |
| `CREWROTA_TAR` | `crew backup`, `crew restore` | `%SystemRoot%\System32\tar.exe` on Windows; `bsdtar`, or a `tar` whose `--version` says bsdtar, elsewhere | Another bsdtar |
| `CREWROTA_CODE` | `crew shortcut`, `crew doctor` | VS Code's `Code.exe` in its usual places on Windows; `code` on PATH | The VS Code program |
| `CREWROTA_PYTHON` | `crew widget` | `pythonw`, then `pyw` on Windows; `python3` elsewhere | The Python that runs the widget |
| `NO_COLOR` | `crew statusline` | unset | Any non-empty value turns the status line's colour off and joins its parts with ` \| ` |
| `CI` | the progress bars of `crew backup` and `crew restore` | unset | `true` turns the bars off |
| `ACCESSIBLE` | the menu, through @clack/core | unset | Any value but `0` or `false` turns on step-by-step prompts for screen readers instead of the one-screen menu |
| `CLAUDE_CODE_GIT_BASH_PATH` | `crew shortcut` on Windows | unset | The Git Bash the shortcut's task runs in, tried first |
| `CREWROTA_DENYLIST` | `npm run check:private` (contributors) | `~/.config/crewrota-private/denylist.txt` | The private denylist file |

## Variables crewrota reads from your system

| Variable | What for |
|---|---|
| `HOME`, `USERPROFILE` | Your home folder: `~/.claude`, `~/.claude.json` and the default crew home |
| `APPDATA` | Windows: `%APPDATA%\crewrota\config.json`, the Start Menu and Startup folders |
| `XDG_CONFIG_HOME` | macOS and Linux: `$XDG_CONFIG_HOME/crewrota/config.json` when it is an absolute path, else `~/.config/crewrota/config.json` |
| `LOCALAPPDATA`, `ProgramFiles` | Windows: where VS Code and Git Bash usually are |
| `SystemRoot` | Windows: where `System32\tar.exe` is |
| `SHELL` | macOS and Linux: the shell a shortcut's task runs in (`/bin/sh` when unset) |
| `CLAUDE_CONFIG_DIR` | `crew statusline` only: the member folder it saves `quota.json` in and names in the line |

## Variables crewrota sets for others

| Variable | Set for | Value |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | every `claude` and quota-axi crewrota starts | The member's folder |
| `LAVISH_AXI_TELEMETRY` | the Claude Code session, at launch | `0`, when you answered no to Lavish telemetry in `crew setup` |
| `GIT_TERMINAL_PROMPT=0`, `GIT_NO_LAZY_FETCH=1`, `GCM_INTERACTIVE=never` | the git reads during `crew backup` | So git never waits for a login |

crewrota removes `QUOTA_AXI_CLAUDE_PROFILES` from quota-axi's environment, because several folders in one call read idle members as `credentials_expired`.

## In a shell that is itself a member

A Claude Code session started by crewrota has `CLAUDE_CONFIG_DIR` set to its member's folder.
`crew` commands run from inside it work as usual, but `crew statusline` would write that member's `quota.json`.
When you try crewrota against a scratch crew from such a shell, unset `CLAUDE_CONFIG_DIR`, `CREW_MEMBER` and `QUOTA_AXI_CLAUDE_PROFILES` first; see [Testing with the fakes](../developers/testing-with-fakes.md).

## Related

- [Files and folders](files-and-folders.md)
- [What happens when a member launches](../concepts/launch.md)
