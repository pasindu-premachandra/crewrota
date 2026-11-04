---
title: "Open a folder as a member from VS Code"
description: "Make a VS Code shortcut that opens a folder and runs Claude Code there as one crew member, with a Start Menu entry and hotkey on Windows."
sidebar:
  order: 7
---

A shortcut opens a folder in VS Code and runs `crew <member>` there, in an editor tab.
Make one with `crew shortcut add <name> --member <member> --folder <path>`, then open it with `crew shortcut open <name>`.
On Windows it also gets a Start Menu entry, with an optional hotkey such as `CTRL+ALT+C`.

## Add a shortcut

```sh
crew shortcut add site --member main --folder E:/demo-crew-inventory/proj/site --hotkey ctrl+alt+c
```

```text
[OK] Shortcut site opens E:/demo-crew-inventory/proj/site in VS Code and runs crew main there.
[i] Workspace file: E:\demo-crew-inventory\crew-home\shortcuts\site.code-workspace
[i] Start Menu: E:\demo-crew-inventory\appdata\Microsoft\Windows\Start Menu\Programs\site.lnk, hotkey CTRL+ALT+C
[i] Open it with: crew shortcut open site
```

- `--member` is required and must be an existing member.
- `--folder` defaults to the folder you run the command in.
- `--hotkey` is optional: `CTRL`, `ALT` or `SHIFT` joined by `+`, then a letter, a digit or `F1` to `F12`. Case does not matter.

A shortcut name follows the same rule as member names: lowercase letters, digits and hyphens, starting with a letter.

## What a shortcut is

- **A workspace file**, `<crew home>/shortcuts/<name>.code-workspace`, on every platform. It opens the folder, puts new terminals in an editor tab, and holds one task that runs `crew <member>` when the folder opens. When the session ends, the tab stays open as a shell in that folder.
- **A Start Menu entry** on Windows, `%APPDATA%\Microsoft\Windows\Start Menu\Programs\<name>.lnk`, that opens the workspace in VS Code. The hotkey opens it too.

The task runs in Git Bash on Windows (Claude Code needs Git for Windows there) and in your `$SHELL` on macOS and Linux.
VS Code brings back that window's layout and its other terminals each time, even when only that window was closed.

On macOS and Linux there is no Start Menu entry or hotkey; `add` prints `[i] The Start Menu entry and the hotkey are Windows-only for now.`

## List, change and remove shortcuts

```sh
crew shortcut list
```

```text
site  crew main  E:/demo-crew-inventory/proj/site  CTRL+ALT+C
```

```sh
crew shortcut set site --member side --no-hotkey
```

```text
[OK] Shortcut site: crew side in E:/demo-crew-inventory/proj/site.
```

`set` changes only what you pass (`--member`, `--folder`, `--hotkey <keys>` or `--no-hotkey`) and writes the files again.

```sh
crew shortcut remove site
```

```text
[OK] Removed shortcut site and its Start Menu entry.
```

`crew rename` moves a member's shortcuts to the new name, and `crew drop` removes them with the member.

## Open a shortcut

```sh
crew shortcut open site
```

It starts VS Code on the workspace file.
crewrota finds VS Code at:

| Platform | Where it looks |
|---|---|
| Windows | `%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe`, then `%ProgramFiles%\Microsoft VS Code\Code.exe`, then `code` on PATH |
| macOS and Linux | the `code` command on PATH |

On a Mac, add `code` to PATH from VS Code's Command Palette: "Shell Command: Install 'code' command in PATH".
`CREWROTA_CODE` points crewrota at another VS Code executable.

## Errors

| Problem | crew says |
|---|---|
| A bad hotkey | `"ctrl+q+z" is not a hotkey. Use CTRL, ALT or SHIFT joined by +, then a letter, digit or F1 to F12, such as CTRL+ALT+C.` |
| The name is taken | `Shortcut site already exists. Change it with: crew shortcut set site` |
| The Start Menu already has that name (Windows) | `The Start Menu already has <file>. Pick another name.` |
| The folder does not exist | `<folder> is not a folder` |
| No VS Code found | `VS Code was not found. Install it from https://code.visualstudio.com, then try again.` |
| The workspace file was deleted | `<file> is missing. Write it again with: crew shortcut set site` |
| No such shortcut | `Shortcut site doesn't exist. Add it with: crew shortcut add site --member <m> --folder <path>` |

On Windows, `add` and `set` need VS Code installed, since the Start Menu entry points at it.
`crew doctor` checks for VS Code once you have a shortcut.

## Related

- [Shortcut commands, in full](../reference/shortcut.md)
- [Add and manage crew members](members.md)
