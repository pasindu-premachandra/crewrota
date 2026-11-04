---
title: "Safety rules for crewrota contributors"
description: "The hard rules every change to crewrota keeps: no credential reads, the main ~/.claude stays read only, no recursive delete through a link, tests only against fakes, and the house style."
sidebar:
  order: 4
  label: "Safety rules"
---

crewrota works inside people's Claude Code setups, so a few rules hold for every change: never read a credential file, never write to the main `~/.claude` or `~/.claude.json`, never delete through a link, and never let a test touch a real account.
They come from the repo's `CLAUDE.md`, which has the full guide.
A change that needs to break one of them needs the maintainer's word first.

## The rules

| Rule | Why |
|---|---|
| Never read, copy or print a credential file: any `.credentials.json` or `.env*` | A member's login is Claude Code's own. crewrota never copies or moves a login; to read usage, quota-axi uses each member's own sign-in on your machine |
| Never write to the main `~/.claude` or `~/.claude.json`; they are read only, for the shared items | Members link to it, so a write would land in every member and in the user's own setup. The one exception is `crew restore`, which adds skills, agents, commands and `CLAUDE.md` to `~/.claude` without overwriting |
| Never a recursive delete through a link | Member folders hold junctions and symbolic links to ships and to `~/.claude`; a recursive delete would follow them. Members and ships are moved to `removed/` after their links are unlinked. The only folder deleted is one crewrota made moments ago in a failed creation, with no link in it |
| Only `src/claude.ts` runs `claude` and quota-axi | One place to swap for the fakes, and one place that sets `CLAUDE_CONFIG_DIR` |
| Tests never call the real `claude` or the real quota-axi | Use the fakes (`CREWROTA_CLAUDE`, `CREWROTA_QUOTA_AXI`) or an injected runner, and call `isolate()` so HOME, USERPROFILE, APPDATA, XDG_CONFIG_HOME and CREWROTA_HOME point at temp folders |
| Write only a member's own files, never through a link | `settings.json`, `.claude.json` and the plugin lists are refused when they are links |
| Never print what a ship's `mcp.json` holds beyond names and types | Headers, environment values and URL queries carry keys; `crew ship mcp list` leaves them out |
| Never send a message except in `crew warmup` | Every other usage reading comes from quota-axi or the status line, which send nothing |

## How the code keeps them

- `findLinks` and `unlinkAll` in `src/links.ts` walk a folder without following links; `moveToRemoved` renames, it never deletes.
- `discardFresh` in `src/members.ts` refuses to delete a new member folder that holds a link.
- `refuseLink` in `src/shared.ts` stops a launch before writing through a link.
- The backup leaves credential and key files out by name and never takes a member folder.
- `describeServer` in `src/cli.ts` prints a server's type and URL without its query, or its command and how many arguments it has.

## House style

- No em dash and no en dash anywhere: code, comments, docs, commit messages. Plain hyphens.
- Comments only where the code is not obvious, one short line.
- Plain words in messages: what happened, then the exact command that fixes it.
- Do not commit during feature work; no commit trailers.
- The private denylist lives outside the repo; never copy its terms into a file. See [CI and the private scan](ci-and-private-scan.md).

## Related

- [Architecture](architecture.md)
- [Testing with the fakes](testing-with-fakes.md)
