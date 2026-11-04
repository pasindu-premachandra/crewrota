---
title: "What happens when a member launches"
description: "The steps crewrota takes between crew <member> and Claude Code starting: pick the member, repair links, copy your main setup and the ship's MCP servers, add the status line, build the arguments."
sidebar:
  order: 2
---

When you run `crew <member>`, `crew run` or pick a member in the menu, crewrota repairs the member's links, copies in your main setup and its ship's MCP servers, then starts `claude` with `CLAUDE_CONFIG_DIR` set to the member's folder.
Claude Code runs in the folder you ran `crew` from, with the member's saved model and effort.
crewrota adds nothing to Claude Code's own behaviour beyond the arguments below.

## The steps

1. **Pick the member.** The name you gave, else `$CREW_MEMBER`, else the current member. With none: `No crew member chosen. Pick one with: crew use <member>`.
2. **Pick the model and effort.** The member's saved ones, else the last ones you used, else Claude's default. In the menu, what you set on the settings line.
3. **Check the permissions answer.** If it has never been answered, crew asks once (in a terminal) or stops (without one). See [Choose whether Claude asks for permission](../guides/permissions.md).
4. **Check the member folder.** If it is missing: `The folder of crew member <m> is missing: <folder>. Log it in again with: crew login <m>`.
5. **Repair the ship links.** For a member on a ship, each of the five history folders is linked to the ship again if the link is missing or wrong.
6. **Bring in your main setup.** Link `skills`, `agents`, `commands` and the plugin folders to `~/.claude`; copy the plugin lists, `settings.json` and `CLAUDE.md`. See [Use your main setup in every member](../guides/main-setup.md).
7. **Copy the MCP servers.** The ship's `mcp.json` (or, for an isolated member, the servers in `~/.claude.json`) replaces the `mcpServers` in the member's `.claude.json`. See [Give a ship's members the same MCP servers](../guides/mcp-servers.md).
8. **Add the status line** if the member's `settings.json` has none.
9. **Start Claude Code.**

Anything crewrota wants you to know from steps 5 to 7 prints as an `[i]` line before Claude starts, for example `[i] Copied this member's history into the ship. ...`.
If a step fails, nothing is launched and the message says what to move or fix.

## The command crewrota runs

```text
claude [--model <model>] [--effort <effort>] [--dangerously-skip-permissions] [<everything after -->]
```

- `--model` and `--effort` only when they are not Claude's default.
- `--dangerously-skip-permissions` only when you answered yes.
- Your own arguments come last, exactly as given after `--`.

For example, with permissions on and Claude's default model and effort, `crew main -- --resume abc` starts:

```text
{"args":["--dangerously-skip-permissions","--resume","abc"],"dir":"E:\\demo-crew-inventory\\crew-home\\members\\main"}
```

That line is the demo stand-in for Claude Code logging the arguments it got and its `CLAUDE_CONFIG_DIR`.

Claude Code's flags must come after `--`.
`crew main --resume abc` stops with `crewrota: Unknown option: --resume`, because everything before `--` is crewrota's.

## The environment

- `CLAUDE_CONFIG_DIR` is the member's folder. This is what makes Claude Code use that member's login, history and settings.
- `LAVISH_AXI_TELEMETRY=0` is added when you answered no to lavish-axi's telemetry in `crew setup`.
- Everything else comes from your shell as it is.

The working folder is the one you ran `crew` from, so Claude Code opens that project.

## While Claude runs

- Ctrl+C goes to Claude Code, not to crewrota.
- When Claude Code exits, `crew` exits with Claude Code's exit code, so a script can check it.
- The model, effort and permissions answer are saved once Claude Code has started, so the next launch reuses them.

## Related

- [The crew menu and crew run, in full](../reference/menu-and-run.md)
- [Members, ships and your main setup](members-and-ships.md)
- [Environment variables](../reference/environment-variables.md)
