---
title: "The Lavish rule the crewrota plugin adds at session start"
description: "What the crewrota plugin's SessionStart hook adds to every Claude Code session, why, and how to turn it off with crew config lavish off."
sidebar:
  order: 3
  label: "Lavish rule hook"
---

The crewrota plugin has one hook: at the start of every Claude Code session it adds a four-line rule that puts questions with options on a Lavish page instead of in chat, and never publishes a page without your word.
Turn it off with `crew config lavish off`, and back on with `crew config lavish on`.
It runs only where the plugin is installed.

## What it adds

When a session starts, Claude Code runs `node "${CLAUDE_PLUGIN_ROOT}/hooks/lavish-rule.mjs"` and adds what it prints to the session's context:

```text
crewrota rule for this session (from the crewrota plugin; the user turns it off with: crew config lavish off)
- A question with options, a tradeoff or evidence behind it goes on a Lavish QA page in the task's review/ folder (npx -y lavish-axi <file>), never as a list in chat. A one-line fact or a single yes or no stays in chat.
- firstmate opens the agents board before its first dispatch, and posts the board's link in chat.
- Never run lavish-axi share (it publishes to a public host) without the user's word for that page.
- No Lavish (not installed, or a headless session): write the questions to the task's questions.md, say so in chat, and wait for the answers.
```

That is the whole hook: it reads one file and prints these lines.
It sends nothing anywhere and writes nothing.

## Turn it off or on

```sh
crew config lavish off
crew config lavish on
```

```text
$ crew config lavish off

Sessions start without the Lavish rule.

[exit code 0]
```

The hook reads crewrota's `config.json` (`%APPDATA%\crewrota\config.json` on Windows; `$XDG_CONFIG_HOME/crewrota/config.json` or `~/.config/crewrota/config.json` elsewhere) and prints nothing when `lavishRule` is `false`.
With no config file, or one it cannot read, the rule stays on.
`crew config show` shows the state as `Lavish rule at session start: on` or `off`.

The change takes effect at the next session start; a running session keeps what it was given.

## Where it is defined

| File | What it holds |
|---|---|
| `plugin/hooks/hooks.json` | One `SessionStart` hook of type `command` |
| `plugin/hooks/lavish-rule.mjs` | The rule text, and the check of `lavishRule` |

## Related

- [/firstmate](firstmate.md)
- [crew config lavish](../reference/config.md#crew-config-lavish)
