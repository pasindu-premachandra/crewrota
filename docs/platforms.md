---
title: "Platforms and versions"
description: "crewrota runs on Windows, with macOS and Linux in beta; what CI tests, which Node.js it needs and how versions are published."
sidebar:
  order: 3
---

Windows is crewrota's main platform.
macOS and Linux are beta: the test suite passes in CI on macOS 15 and on Ubuntu, but neither has yet been tested thoroughly by hand.
Every platform needs Node.js 22.19 or newer and Claude Code.

## Support by platform

| Platform | Status | Quickstart |
|---|---|---|
| Windows 10 and 11 | Main platform | [Windows](windows/quickstart.md) |
| macOS | Beta | [macOS (beta)](macos/quickstart.md) |
| Linux | Beta | [Linux (beta)](linux/quickstart.md) |

> **Beta:** macOS and Linux are beta. The test suite passes in CI on macOS 15 and Ubuntu (`.github/workflows/ci.yml`), but they have not yet been tested thoroughly by hand.

## What CI covers

Every push to `main` and every pull request runs the test job on three runners:

| Runner | Notes |
|---|---|
| `windows-latest` | |
| `macos-15` | |
| `ubuntu-latest` | installs `libarchive-tools` first, for the backup tests |

Each runs `npm ci`, `npm run typecheck` and `npm test` on Node 22.
A separate job scans the history for secrets with gitleaks.
The tests never call the real Claude Code or the real quota-axi: they use stand-ins, so CI checks crewrota's own logic, not a real login, a real usage reading or the widget window itself.

## What differs between platforms

| Topic | Windows | macOS (beta) | Linux (beta) |
|---|---|---|---|
| Settings file | `%APPDATA%\crewrota\config.json` | `~/.config/crewrota/config.json` | same as macOS |
| Crew home | `%USERPROFILE%\.crewrota` | `~/.crewrota` | `~/.crewrota` |
| Folder links | junctions | symlinks | symlinks |
| Backup zip tool | `System32\tar.exe`, which is bsdtar | `bsdtar`, or a `tar` that is bsdtar | install `libarchive-tools` |
| Desktop widget | `pythonw` or `pyw`; can open at login | `python3`; not at login | `python3`; not at login |
| Menu bar | none | SwiftBar or xbar plugin | none |
| VS Code shortcut | workspace file, Start Menu entry and hotkey; runs in Git Bash | workspace file only; runs in `$SHELL` | same as macOS |
| Path matching | ignores case | case-sensitive | case-sensitive |

`XDG_CONFIG_HOME`, when set to an absolute path, moves the settings file on macOS and Linux to `$XDG_CONFIG_HOME/crewrota/config.json`.
`CREWROTA_HOME` moves the crew home on every platform.
See [Files and folders](reference/files-and-folders.md).

## Node.js

The npm package asks for Node.js 22.19 or newer (`"node": ">=22.19"` in `package.json`).
`crew doctor` reports the Node version you have and fails its Node check below version 22.
The install-from-source scripts also stop below Node 22.

## Versions and releases

- crewrota is published on npm as `crewrota` and follows semantic versioning. This page describes 1.0.4.
- `crew --version` prints the installed version alone.
- The Claude Code plugin installs from the GitHub repo `pasindu-premachandra/crewrota`; its version matches the npm package, and a test checks that the two agree.
- Each release is a `vX.Y.Z` tag on GitHub, such as `v1.0.4`.

Update with `npm install -g crewrota`; see [Install crewrota](install.md).

## Related

- [Install crewrota](install.md)
- [Build and test crewrota](developers/build-and-test.md)
- [CI and the private scan](developers/ci-and-private-scan.md)
