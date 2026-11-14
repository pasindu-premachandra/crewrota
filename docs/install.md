---
title: "Install crewrota"
description: "Install crewrota with npm on Node.js 22.19 or newer, check it with crew doctor, and update, uninstall or install it from source."
sidebar:
  order: 1
---

You need Node.js 22.19 or newer and Claude Code.
Install crewrota with `npm install -g crewrota`, then run `crew doctor` to check the setup.
The same command updates it, and `npm uninstall --global crewrota` removes it.

## What you need first

- **Node.js 22.19 or newer.** The npm package asks for `node >=22.19`. Download it from https://nodejs.org/en/download and check it with `node --version`.
- **Claude Code.** crewrota runs the `claude` command for every login and launch. Check it with `claude --version`.

How to install Claude Code on each platform:

| Platform | Command |
|---|---|
| Windows (PowerShell) | `irm https://claude.ai/install.ps1 \| iex`, or `winget install Anthropic.ClaudeCode` |
| macOS | `curl -fsSL https://claude.ai/install.sh \| bash`, or `brew install --cask claude-code` |
| Linux | `curl -fsSL https://claude.ai/install.sh \| bash` |

These are the same fix lines `crew doctor` prints when it cannot find `claude`.

## Install with npm

```sh
npm install -g crewrota
```

It installs three names for the same command: `crew`, `crw` and `crewrota`.
These docs use `crew`.

Check the version:

```sh
crew --version
```

```text
1.0.4
```

## Check the setup

```sh
crew doctor
```

```text
ok    Node 22.21.1
ok    claude 2.1.310 (Claude Code) (fake)
ok    crewrota home E:\demo-crew-inventory\crew-home
ok    config E:\demo-crew-inventory\appdata\crewrota\config.json (not created yet)
ok    no crew members yet (add one with: crew add <member>)
ok    --dangerously-skip-permissions: not asked yet (asked at the first launch)
miss  lavish skill: missing
      fix: npx skills add kunchenguid/lavish-axi --skill lavish -g (or: crew setup)
miss  gh-axi skill: missing
      fix: npx skills add kunchenguid/gh-axi --skill gh-axi -g (or: crew setup)
miss  quota-axi skill: missing
      fix: npx skills add kunchenguid/quota-axi --skill quota-axi -g (or: crew setup)
miss  treehouse: missing
      fix: irm https://kunchenguid.github.io/treehouse/install.ps1 | iex (or: crew setup)
miss  playwright-cli: missing
      fix: npm install -g @playwright/cli@latest, then playwright-cli install --skills (or: crew setup)
ok    playwright MCP: installed
miss  gh-axi and lavish-axi commands (opt-in): missing
      fix: npm install -g gh-axi lavish-axi (or: crew setup --with-hooks)
miss  gh-axi session hook (opt-in): missing
      fix: gh-axi setup hooks (or: crew setup --with-hooks)
miss  lavish-axi session hook (opt-in): missing
      fix: lavish-axi setup hooks (or: crew setup --with-hooks)
miss  gh sign-in: gh is not signed in
      fix: gh auth login (run it yourself; crewrota never runs it)
ok    Lavish telemetry: not asked yet
```

`ok` lines are fine, `miss` lines are optional tools, and a `FAIL` line comes with a `fix:` line.
`crew doctor` exits with code 1 only when a required check fails; a missing tool never fails it.
This output comes from a demo crew with a stand-in for Claude Code (hence `(fake)`), so the folders read `E:\demo-crew-inventory`; yours show your own crew home, `~/.crewrota` by default.
See [Fix a problem with crew doctor](guides/troubleshooting.md).

## Update

Run the install again:

```sh
npm install -g crewrota
```

Your members, ships and settings live outside the package, so an update leaves them alone.

## Uninstall

```sh
npm uninstall --global crewrota
```

This removes the commands only.
Your crew home (`~/.crewrota`) and settings file (`%APPDATA%\crewrota\config.json` on Windows, `~/.config/crewrota/config.json` elsewhere) stay where they are; delete them yourself if you want them gone.
Each member folder holds links to your ships and to `~/.claude`.
Drop members with `crew drop <member>` before you delete anything: it removes those links, then moves the folder to `removed/`.
Never delete a member folder with a tool that follows links.

## Install from source

In a clone of the repo:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

```sh
sh scripts/install.sh
```

The first is for Windows, the second for macOS and Linux.
Each checks for Node 22.19, runs `npm ci`, builds crewrota, packs it the way it would be published, installs that package globally, deletes the packed file and prints `crew --version`.
Run it again after pulling changes to update.

## Add the Claude Code plugin

The plugin adds `/firstmate` and the Lavish rule.
Run these in your main Claude Code, not inside a member:

```sh
claude plugin marketplace add pasindu-premachandra/crewrota
claude plugin install crewrota@crewrota
```

Every member links your main plugin cache and copies your plugin lists at its next launch, so you install the plugin once.
The plugin is not in the npm package; it installs from the GitHub repo.
See [Guide for AI agents](agents/index.md) and [/firstmate](agents/firstmate.md).

## Install the default tools

`crew setup` installs the tools firstmate expects (the lavish, gh-axi and quota-axi skills, treehouse, Playwright CLI and a Playwright MCP entry for each ship), after one list and one yes.
See [crew setup, init and doctor](reference/setup-init-doctor.md).

## Next

- [Your first crew in five minutes](first-crew.md)
- Step by step: [Windows](windows/quickstart.md), [macOS (beta)](macos/quickstart.md), [Linux (beta)](linux/quickstart.md)
