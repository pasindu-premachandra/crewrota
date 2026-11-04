---
title: "crew config reference"
description: "Reference for crew config permissions, refresh, lavish and show, and every key crewrota keeps in config.json."
sidebar:
  order: 7
  label: "Config"
---

`crew config` changes the settings crewrota remembers: `permissions` for `--dangerously-skip-permissions`, `refresh` for the usage check when the menu opens, and `lavish` for the plugin's rule at session start.
`crew config show` prints them all.
Every `crew config` command runs without a terminal; the settings live in `config.json` (`%APPDATA%\crewrota\config.json` on Windows, `~/.config/crewrota/config.json` elsewhere).

Any other form prints `Usage: crew config permissions on|off | crew config refresh on|off | crew config lavish on|off | crew config show` and exits with 1.

## crew config permissions

Start every session with `--dangerously-skip-permissions`, or not.

```sh
crew config permissions on
crew config permissions off
```

```text
$ crew config permissions on

--dangerously-skip-permissions is on for every launch.

[exit code 0]
```

```text
$ crew config permissions off

--dangerously-skip-permissions is off for every launch.

[exit code 0]
```

- Until you answer, the first launch in a terminal asks once, and `crew run` without a terminal refuses (see [crew run](menu-and-run.md#without-a-terminal)).
- With it on, Claude Code edits files and runs commands without asking you first.
- Key: `skipPermissions` (`true`, `false`, or `null` for not asked yet).

## crew config refresh

Read every member's usage with quota-axi when the menu and `crew quota` open, or show the last readings.

```sh
crew config refresh on
crew config refresh off
```

```text
$ crew config refresh on

The menu reads every member's usage with quota-axi as it opens; no message is sent.
Turn it off with: crew config refresh off

[exit code 0]
```

```text
$ crew config refresh off

The menu shows each member's last reading.

[exit code 0]
```

- On by default. quota-axi sends no message.
- Key: `refreshReadings`; only `false` turns it off.

## crew config lavish

Add the crewrota plugin's Lavish rule at every session start, or stop that.

```sh
crew config lavish on
crew config lavish off
```

```text
$ crew config lavish on

Every session starts with the Lavish rule from the crewrota plugin.

[exit code 0]
```

```text
$ crew config lavish off

Sessions start without the Lavish rule.

[exit code 0]
```

- On by default. It matters only when the plugin is installed; the plugin's hook reads this key. See [The Lavish rule hook](../agents/lavish-hook.md).
- Key: `lavishRule`; only `false` turns it off.

## crew config show

```sh
crew config show
```

```text
$ crew config show

Config file: E:\demo-crew-inventory\appdata\crewrota\config.json
Crew home: E:\demo-crew-inventory\crew-home
--dangerously-skip-permissions: on
Usage check when the menu opens: on
Lavish rule at session start: on
Lavish telemetry: not asked yet (crew setup asks)
Last model: default, last effort: default
Current member: main, previous: side
  main: model default, effort default, ship home
  side: model default, effort default, ship home
  team: model default, effort default, isolated

[exit code 0]
```

The output is text for people, not JSON; a script reads `config.json` instead.

## Keys in config.json

| Key | Values | Set by |
|---|---|---|
| `skipPermissions` | `true`, `false`, `null` (not asked yet) | the first launch, `crew config permissions` |
| `refreshReadings` | `false` for off; absent or `true` for on | `crew config refresh` |
| `lavishRule` | `false` for off; absent or `true` for on | `crew config lavish` |
| `lavishTelemetry` | `true` or `false`, absent until asked | `crew setup` in a terminal; `false` adds `LAVISH_AXI_TELEMETRY=0` to every launch |
| `lastModel`, `lastEffort` | a model and an effort, `default` for Claude's own | every launch |
| `current`, `previous` | member names | `crew use`, `crew add`, `crew rename`, `crew drop` |
| `members.<name>` | `{ "provider": "claude", "created": "<time>", "ship"?, "model"?, "effort"? }` | `crew add`, `crew ship join`, every launch, `crew restore` |
| `shortcuts` | a list of `{ "name", "member", "folder", "hotkey"? }` | `crew shortcut` |

A sample from a demo crew:

```json
{
  "skipPermissions": true,
  "lavishRule": true,
  "lastModel": "default",
  "lastEffort": "default",
  "current": "main",
  "previous": "side",
  "members": {
    "main": {
      "provider": "claude",
      "created": "2026-11-04T00:00:00.000Z",
      "ship": "home",
      "model": "default",
      "effort": "default"
    },
    "side": {
      "provider": "claude",
      "created": "2026-11-04T00:00:00.000Z",
      "ship": "home",
      "model": "default",
      "effort": "default"
    },
    "team": {
      "provider": "claude",
      "created": "2026-11-04T00:00:00.000Z"
    }
  }
}
```

A `config.json` that is not valid JSON makes every command that reads it fail; `crew doctor` names the file and tells you to fix the JSON or rename the file so crewrota starts a fresh one.

## Related

- [Choose whether Claude asks for permission](../guides/permissions.md)
- [Files and folders](files-and-folders.md)
