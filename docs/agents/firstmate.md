---
title: "Hand a task to your crew with /firstmate"
description: "The /firstmate skill in the crewrota Claude Code plugin: install it, what its nine steps do, the task folder, routing rules in crewrota.json, how lanes are dispatched and followed up, and what each failure means."
sidebar:
  order: 1
  label: "/firstmate"
---

`/firstmate <task>` hands one task to one or more crew members running headless, with your current Claude Code session as the first mate: it reads, asks, plans, starts the runs, waits, checks the results and reports.
It comes with the crewrota Claude Code plugin; install it in your main Claude Code with `claude plugin marketplace add pasindu-premachandra/crewrota` and `claude plugin install crewrota@crewrota`.
Nothing is committed, merged or published without your word.

## Install

```sh
claude plugin marketplace add pasindu-premachandra/crewrota
claude plugin install crewrota@crewrota
```

Run these in your main Claude Code, not inside a member: every member links your main plugin cache and copies its plugin lists at launch, so every member gets the plugin.
The plugin also adds [the Lavish rule hook](lavish-hook.md).

firstmate runs on these tools, all installed by [`crew setup`](../reference/setup-init-doctor.md#crew-setup); `crew doctor` lists any that are missing:

| Tool | Used for |
|---|---|
| `crew` | Picking and starting members |
| `treehouse` | A leased git tree per lane |
| `npx -y quota-axi` | Each member's live quota |
| `npx -y gh-axi` | GitHub |
| `npx -y lavish-axi` | Pages for questions and the agents board |
| `playwright-cli` | Checking a change in a browser |

Then, in each project you want to use it in, run [`crew init`](../reference/setup-init-doctor.md#crew-init) once: firstmate finds the project root by its `.claude/crewrota.json`.

## Start it

```text
/firstmate add a dark mode toggle to the settings page
/firstmate side review the open PR for missing tests
```

A leading member name forces that member; if the first word could belong to the task instead, firstmate asks.
It also starts when you say "use crew <member> ...", or ask to delegate, offload, scout or investigate work on crew members, or ask for the agents board.

## When it fits

- Hand off well-defined work whose result can be checked: tests, refactors, docs, mechanical edits, a bounded investigation, a reproduction, an audit.
- Keep in your own session: design and architecture calls, security-sensitive code, anything that needs a conversation, and work you want to watch step by step.
- Several lanes fit when the work splits into parts that touch different files and each part can be proven on its own.
- It never starts a run you did not ask for: every lane spends a member's quota and runs with permission prompts off.

## The nine steps

Steps 2 and 5 stop for you, and only when a question would change what gets built (2), or once on scope (5).
Every other step always happens, even for one lane.

| Step | What happens |
|---|---|
| 1. Read | Finds the project root (the nearest `.claude/crewrota.json` going up), reads `.claude/CLAUDE.md`, the memories that touch the task, matching skills and `.claude/tasks/INDEX.md`, and any task folder that already exists. Classifies the work as **Ship** (a change to files, left for review) or **Scout** (a `report.md` only, never a code change). Makes the task folder |
| 2. Ask | Puts each question with options on a Lavish page in the task's `review/` folder and waits for your answers; a one-line fact stays in chat |
| 3. PRD | Writes goals, numbered requirements, non-goals and how we know it worked into the task README |
| 4. Tasks | Writes the task list: which lane owns which file, shared names, ports and test data, decided up front because a lane cannot ask |
| 5. Go? | One Lavish page with the plan, the lanes and the member for each, and one go or no-go; skipped when you already gave the scope in so many words |
| 6. Board | Writes the lanes file, builds [the agents board](board.md), opens it and posts its link before the first run starts |
| 7. Lanes | Picks a member per lane, writes one brief per lane, gives each lane its own tree, and starts each run as a background job |
| 8. Validate | Reads each run's result, report and diff, re-runs one of its proof commands, joins several lanes on one branch, then checks the change itself |
| 9. Draft and write back | Drafts the ticket update in `evidence/ticket-update.md` for you to paste (it never posts), writes each gotcha into `.claude/memories/`, and closes the README |

Without Lavish (not installed, or a headless session), the questions and the go or no-go go to `.claude/tasks/<slug>/questions.md`, and the board is written as a Markdown file.

## The task folder

```text
.claude/tasks/<slug>/
  README.md      the task: your ask word for word, the approach, tasks, files, validation, history
  evidence/      briefs, lane runs, reports, quota readings, validation proof, ticket-update.md
  review/        Lavish pages: questions, the plan, the agents board
```

One line for it goes into `.claude/tasks/INDEX.md`.
The README follows `readme-template.md` in the skill folder: What is asked, The approach, Tasks, Files, Validation, Ticket updates, Open questions, Gotchas found on the way, Folder and History.

## Pick a member: routing

For each lane, in this order:

1. **The member you named.**
2. **Routing rules** in `.claude/crewrota.json`. A rule whose `work` matches the task limits the pick to its members, tried in order:

   ```json
   {
     "version": 1,
     "routing": [
       { "work": "docs and tests", "members": ["side", "team"] }
     ]
   }
   ```

3. **Quota.** firstmate reads every eligible member live, one call per member, side by side; no message is sent:

   ```sh
   CLAUDE_CONFIG_DIR="<crew home>/members/<member>" npx -y quota-axi --provider claude --json > "<task>/evidence/quota-<member>.json"
   ```

   - A member has room while both its 5-hour and week windows are under about 80% used (percent used is `100 - percentRemaining`).
   - A reading that is not `fresh` is unknown quota: it says so, and the member stays eligible. The fallback is the member's own `quota.json`.
   - It skips the member it is itself running on, and any member on the same email and organisation as another, since they share one quota.
   - A rule takes the first member in its order that has room; otherwise the most 5-hour room wins.
   - If every eligible member is tight, it stops and asks you. It never drops quietly to a weaker model.

It states the pick with the numbers, and leaves model and effort alone: `crew run` passes each member's remembered ones.
A member not used today, or after a login change, gets a preflight first: `crew run <member> -- -p "Reply with the single word READY and nothing else."`.

## Briefs

Each lane gets `evidence/brief-lane-<name>.md`, from `brief.md` in the skill folder:

- `## Intent` holds your own words, word for word, plus any boundary you stated. Validation treats it as the acceptance check.
- `## Spec` holds the build instructions and what is out of scope, with absolute paths, and decides every open point, since a lane cannot ask.
- Where it works, what it may write, what it must prove, and what its `report.md` must hold.

If you add to the ask mid-run, your words are appended to `## Intent` and carried in the follow-up.

## A tree per lane

Every lane in a git repo gets its own tree, scouts included:

- With `treehouse`: `treehouse get --lease --json --lease-holder <member>:<slug> -b crew/<slug>` for a ship lane, without `-b` for a scout (detached). Gitignored files a lane needs are listed in the repo's `.worktreeinclude`, which treehouse copies.
- Without it: `git worktree add -b crew/<slug> <repo>/../.worktrees/<slug> <base branch>` (or `--detach` for a scout). A plain worktree holds only committed files.
- Not a git repo: the lane works in place, and the brief names the only files it may write.

## Dispatch

Each lane starts as one background job, after the board is open:

```sh
E="<task>/evidence/lane-<name>"
mkdir -p "$E" && cd "<lane tree>" && crew run <member> -- -p "<one line naming the rules>. Read the brief at <absolute path> and carry it out completely, start to finish, without stopping to ask anything." --output-format json > "$E/run.json" 2> "$E/run.err"
```

- `crew run` starts Claude in the folder it is run from, as that member, with its ship's history and MCP servers. Everything after `--` goes to Claude.
- A headless run cannot answer permission prompts: crewrota adds `--dangerously-skip-permissions` while `crew config permissions on` is set. firstmate says so, and keeps each brief's write boundary tight.
- The prompt stays one short line pointing at the brief; a long multi-line argument can be cut short on Windows.
- The background job is the supervision: firstmate is told when the lane exits, and never reports a result before that.
- Before calling a lane stuck, it checks whether the session log is still growing and whether any file in its tree changed in the last ten minutes.

## Follow up

`run.json` carries the run's `session_id`.
A follow-up resumes that session in the same tree, with Claude's flags after `--`:

```sh
cd "<same tree>" && crew run <member> -- -p "<follow-up>" --resume <session_id> --output-format json > "$E/run-2.json" 2> "$E/run-2.err"
```

If that fails, it starts a fresh run in the same tree, pointed at the brief, `git status` and the last report.

## Validate

A lane's report is a claim, not proof.
For each lane firstmate reads `run.json` (`is_error`, `result`, `num_turns`, `duration_ms`), then `report.md` (its Deviations and "Noticed and left alone" first), then the diff against `## Intent`, and re-runs one proof command itself.
Several lanes are joined on one branch, and the joined result is proven again.
Then the change is checked by what it is:

| Change | Check |
|---|---|
| Anything visible | Playwright CLI drives the real flow at desktop and mobile widths; screenshots before and after |
| API, webhook, agent turn | The real request, saved with its response |
| Library or CLI | The project's tests and lint, plus the command a user would run |
| Config, data, docs | Read back from the live system; links checked |

Anything not validated is listed in the README with the reason.

## Land and clean up, only on your word

- Ship work stays uncommitted in its tree until you say: commit, PR, or copy into the main tree. Commits, pushes and merges are the first mate's, never a lane's.
- A tree is returned only when nothing in it is unlanded (`git status --porcelain` empty and nothing missing from the base), with `treehouse return --if-lease-id <lease_id>` or `git worktree remove <path>`. Never with `--force`.

## Failure signatures

| What you see | What it means | What to do |
|---|---|---|
| `Crew member X doesn't exist` | No such member | `crew list`; add it with `crew add <member>` and sign in |
| `config permissions on` in `run.err` | The permissions question is not answered | `crew config permissions on`, on your word |
| `credentials_expired` in a quota reading | The member's sign-in expired since its last session | Read it alone; if it stays expired, run `crew login <member>` |
| Empty `run.json`, or `is_error` with "hit your session limit" | The member is out of quota | Wait for the reset, or use another eligible member in the same tree |
| Text before the JSON in `run.json` | crewrota's `[i]` notes | Read the line that holds `"result"` |
| An argument like `/api/x` arrived as a Windows path | Git Bash path conversion | Put `MSYS_NO_PATHCONV=1` in front |
| The prompt arrived cut short | A long multi-line argument on Windows | One short line pointing at the brief file |
| `treehouse get` fails | treehouse is missing or its pool is busy | `crew doctor`; fall back to a plain worktree |

## The skill's files

The plugin's `skills/firstmate/` folder holds `SKILL.md` (the steps above), `brief.md` (the lane brief skeleton), `readme-template.md` (the task README) and `board.js` (the agents board).

## Related

- [The agents board](board.md)
- [The Lavish rule hook](lavish-hook.md)
- [AI agent guide](index.md)
- [crew run](../reference/menu-and-run.md#crew-run)
