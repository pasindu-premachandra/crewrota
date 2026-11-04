---
title: "crew shortcut reference"
description: "Reference for crew shortcut add, list, set, remove and open: VS Code workspace files that run a crew member in a folder, with a Start Menu entry and hotkey on Windows."
sidebar:
  order: 5
  label: "Shortcuts"
---

A shortcut is a VS Code workspace file that opens one folder and runs `crew <member>` there in an editor tab.
`crew shortcut add` makes one, `list` shows them, `set` changes one, `remove` deletes one and `open` opens one in VS Code.
On Windows each shortcut also gets a Start Menu entry, with an optional hotkey.
None of them asks a question, so all run without a terminal.

Shortcut names follow the member name rule: lowercase letters, digits and hyphens, starting with a letter, at most 32 characters.
A wrong subcommand prints `Usage: crew shortcut add|list|set|remove|open (see crew --help)` and exits with 1.

## crew shortcut add

```sh
crew shortcut add <name> --member <member> [--folder <path>] [--hotkey <keys>]
```

| Flag | Default | What it does |
|---|---|---|
| `--member <member>` | required | The member the shortcut starts |
| `--folder <path>` | the current folder | The folder VS Code opens and Claude starts in |
| `--hotkey <keys>` | none | Windows only: a hotkey for the Start Menu entry |

```text
$ crew shortcut add site --member main --folder E:/demo-crew-inventory/proj/site --hotkey ctrl+alt+c

[OK] Shortcut site opens E:/demo-crew-inventory/proj/site in VS Code and runs crew main there.
[i] Workspace file: E:\demo-crew-inventory\crew-home\shortcuts\site.code-workspace
[i] Start Menu: E:\demo-crew-inventory\appdata\Microsoft\Windows\Start Menu\Programs\site.lnk, hotkey CTRL+ALT+C
[i] Open it with: crew shortcut open site

[exit code 0]
```

On macOS and Linux the Start Menu line reads `[i] The Start Menu entry and the hotkey are Windows-only for now.`

### What it writes

- `<crew home>/shortcuts/<name>.code-workspace`: the folder, terminal settings that put the terminal in an editor tab, and one task that runs on folder open. The task runs `crew <member>` in Git Bash on Windows (or your `$SHELL` elsewhere), then keeps that shell open in the tab when the session ends.
- On Windows, `%APPDATA%\Microsoft\Windows\Start Menu\Programs\<name>.lnk`, which opens the workspace file with VS Code's `Code.exe`, written through PowerShell.
- The shortcut in `config.json` under `shortcuts`.

### Hotkeys

`CTRL`, `ALT` or `SHIFT` joined by `+`, then one letter, digit or `F1` to `F12`; upper or lower case.
Anything else fails:

```text
$ crew shortcut add api --member main --folder E:/demo-crew-inventory/proj/api --hotkey ctrl+q+z

crewrota: "ctrl+q+z" is not a hotkey. Use CTRL, ALT or SHIFT joined by +, then a letter, digit or F1 to F12, such as CTRL+ALT+C.

[exit code 1]
```

### Finding VS Code and the shell

- On Windows, VS Code must be found, or `add`, `set` and `open` fail with `VS Code was not found. Install it from https://code.visualstudio.com, then try again.` crewrota looks at `CREWROTA_CODE`, then `%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe`, then `%ProgramFiles%\Microsoft VS Code\Code.exe`, then `where code`.
- Elsewhere it uses `CREWROTA_CODE` or `code` on PATH, and only `open` needs it.
- The Windows shell is Git Bash: `CLAUDE_CODE_GIT_BASH_PATH`, then the Git install next to `git` on PATH, then `%ProgramFiles%\Git\bin\bash.exe`.

### Other errors

`Shortcut <name> already exists. Change it with: crew shortcut set <name>`, `The Start Menu already has <file>. Pick another name.` (Windows, where these names ignore case), `<path> is not a folder`, and an unknown member.

## crew shortcut list

```sh
crew shortcut list
```

```text
$ crew shortcut list

site  crew main  E:/demo-crew-inventory/proj/site  CTRL+ALT+C

[exit code 0]
```

With none it prints `No shortcuts yet. Add one with: crew shortcut add <name> --member <m> --folder <path>`.

## crew shortcut set

Change only the parts you name, then write the files again.

```sh
crew shortcut set <name> [--member <member>] [--folder <path>] [--hotkey <keys> | --no-hotkey]
```

| Flag | What it does |
|---|---|
| `--member <member>` | Run another member |
| `--folder <path>` | Open another folder |
| `--hotkey <keys>` | A new hotkey (Windows) |
| `--no-hotkey` | Drop the hotkey; not with `--hotkey` |

```text
$ crew shortcut set site --member side --no-hotkey

[OK] Shortcut site: crew side in E:/demo-crew-inventory/proj/site.

[exit code 0]
```

With no flags it writes the files again as they are, which repairs a missing workspace file.
An unknown shortcut fails with `Shortcut <name> doesn't exist. Add it with: crew shortcut add <name> --member <m> --folder <path>`.

## crew shortcut remove

```sh
crew shortcut remove <name>
```

```text
$ crew shortcut remove site

[OK] Removed shortcut site and its Start Menu entry.

[exit code 0]
```

It deletes the workspace file and the Start Menu entry, and nothing else.

## crew shortcut open

```sh
crew shortcut open <name>
```

It starts VS Code on the workspace file, detached, and prints `[OK] Opening <workspace file> with <VS Code>`.
VS Code then runs the task, which starts the member in the folder.
A missing workspace file fails with `<file> is missing. Write it again with: crew shortcut set <name>`.

## When members change

- `crew rename <old> <new>` rewrites every shortcut of that member to run `crew <new>` and lists them.
- `crew drop <member>` deletes that member's shortcuts.

## Related

- [Open a folder as a member from VS Code](../guides/vscode-shortcuts.md)
- [Environment variables](environment-variables.md)
