---
title: "Where usage readings come from"
description: "How crewrota gets each member's 5-hour and week usage: quota-axi when the menu opens, the status line during a session, and crew warmup, the only command that sends a message."
sidebar:
  order: 3
---

Each member's usage reading is saved in `quota.json` in its folder, and everything that shows usage reads that file.
Readings come from three places: quota-axi, which crewrota runs when the menu opens and on `crew quota`; crewrota's status line, while a session runs; and `crew warmup`.
Only `crew warmup` sends a message.

## The three sources

| Source | When | Sends a message |
|---|---|---|
| quota-axi | The crew menu opening and `crew quota`, unless `crew config refresh off` | No |
| crewrota's status line | Every time Claude Code redraws it in a running session | No |
| `crew warmup` | Only when you run it, or press the widget's bolt | Yes, one short Haiku message per member |

### quota-axi

crewrota ships with quota-axi, a tool that asks Claude for an account's usage without sending a message.
crewrota runs it once per member, side by side, with `CLAUDE_CONFIG_DIR` set to that member's folder, and saves only a fresh reading.
crewrota never copies or moves a login; to read usage, quota-axi uses each member's own sign-in on your machine.
A member whose check fails or times out (after 30 seconds) keeps its last reading.

### The status line

A member with no status line of its own gets `crewrota statusline`.
Claude Code passes it the session's usage each time it redraws, and it saves that to `quota.json`.
A reading from an older session never overwrites a newer one.
See [the status line](../guides/main-setup.md#the-status-line).

### crew warmup

`crew warmup` starts Claude Code once per member with a one-word prompt on Haiku, reads the usage Claude Code reports, and stops it as soon as that arrives (or after 30 seconds).
The run saves no session and loads none of the member's settings, hooks or MCP servers.
It is the only crewrota command that sends a message, and that message counts toward the member's usage; it starts the member's 5-hour window if none is running.
Nothing runs it on a timer; only you do.

## What reads the readings

The crew menu, `crew quota`, `crew list`, `crew quota --format menubar` (the macOS menu bar), and the widget.
`crew list`, the menu bar and the widget never take a reading themselves; they show the last one.

A reading older than its window's reset time shows 0% for that window, since the window has reset since.
The widget dims a member whose reading is more than 6 hours old, and `crew list` shows each reading's age.

## The file

```text
{"ts":1794601388,"seen":1794601388,"five_hour_pct":30,"seven_day_pct":55,"five_hour_resets_at":2000000000,"seven_day_resets_at":2000604800,"fable_pct":20,"fable_resets_at":2000604800}
```

| Key | Meaning |
|---|---|
| `ts` | When the reading was saved, in Unix seconds |
| `seen` | When the session it came from was last active; keeps an older session from overwriting a newer reading |
| `five_hour_pct`, `seven_day_pct` | Percent used, or `""` when unknown |
| `five_hour_resets_at`, `seven_day_resets_at` | Reset times in Unix seconds, or `""` |
| `fable_pct`, `fable_resets_at` | The weekly Fable figure and its reset time, or `""` when the member has none |

## The Fable figure

On plans with a Fable limit (up to 50% of the weekly limit on Max, Ultra and premium seats, per [Claude Fable models on your plan](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan)), quota-axi reports it beside the 5-hour and week windows.
Only that reading, from the crew menu or `crew quota`, sets `fable_pct`; a fresh one without a Fable figure clears it, so an old figure does not linger.
Claude Code's status line never carries a Fable figure, so `crew statusline` and `crew warmup` keep the last one.

It is written to `quota.json.tmp` first and then renamed, so a reader never sees half a file.

## Related

- [Check every member's usage](../guides/usage-and-quota.md)
- [Usage commands, in full](../reference/usage.md)
- [Files and folders](../reference/files-and-folders.md)
