---
name: firstmate
description: >-
  Run a task through one or more crew members (crewrota members, each its own
  Claude login) working headless, with this session as the first mate: it reads
  the project's root .claude/ folder, asks its questions on a Lavish page, writes
  the PRD and task list into the task's README, opens the agents board, picks each
  member by rule and live quota, gives every lane its own leased git tree, checks
  each result itself, validates the change, drafts the ticket update for the user
  to paste, and writes what it learned back into .claude/memories/. One skill for
  1 to N lanes. Use when the user types /firstmate, says "use crew <member> ...",
  asks to delegate, offload, scout, investigate or split work across crew members
  or in parallel lanes, or asks for the agents board. Not for in-session subagents.
---

# firstmate

One task, one or more headless runs on other crew members, with this session as the first mate.
The first mate reads, asks, plans, dispatches, waits, checks, validates and reports; the lanes do the work.

Files in this folder:

- `SKILL.md`: this file.
- `brief.md`: the skeleton every lane brief starts from.
- `readme-template.md`: the task README, every section in order.
- `board.js`: builds the agents board from the lanes' own files (`node "${CLAUDE_SKILL_DIR}/board.js" <lanes.json> <out.html | out.md> [--watch 60]`).

Tools it runs on, all installed by `crew setup`: `crew` (crewrota), `treehouse` (leased git trees), `npx -y quota-axi` (live quota), `npx -y gh-axi` (GitHub), `npx -y lavish-axi` (pages for questions and the board), `playwright-cli` (validation).
`crew doctor` lists which are missing.

## Request

$ARGUMENTS

If the request is non-empty, run the flow below for it.
A leading member name (`/firstmate review <task>`) forces that member and skips the pick in step 7. If that first word plainly belongs to the task instead, ask.

## When it fits

Delegate well-defined work whose result can be checked: tests, refactors, docs, mechanical edits, a bounded investigation, a reproduction, an audit.
Keep in this session: design and architecture calls, security-sensitive code, anything that needs a conversation with the user, and work the user is watching step by step.
Several lanes fit when the work splits into parts that touch **different files** and each part can be proven on its own.
Never start a run the user did not ask for: every lane spends a member's quota and runs with permission prompts off.

## The nine steps

Steps 2 and 5 stop for the user, and only when a question would change what gets built (2) or once on scope (5).
Every other step always happens, even on a one-lane task.

### 1. Read the root .claude/

Find the project root: the nearest folder up from here with `.claude/crewrota.json`.
If there is none, say so and offer `crew init` (it writes the folder and never overwrites a file); do not create it yourself.

Read, in order: `.claude/CLAUDE.md`, `.claude/memories/README.md` and each memory whose line touches the task, any skill in `.claude/skills/` that matches it, and `.claude/tasks/INDEX.md`.
If a task folder for this ask already exists, read its `README.md`, `evidence/` and `review/` first. If they already answer the question, answer it and do not commission a run to rediscover it.

Then classify the deliverable:

- **Ship** (the default): a change to files, left for review.
- **Scout**: knowledge only, a `report.md`, never a code change. Use it for an investigation, a plan, a reproduction or an audit, or when an open question could change whether or what to build.

**Evidence is not authorization.** A scout's findings, a diagnosis or a recommendation never authorize a code change; turning a report into a ship needs the user's word.
Do not double up: never present a likely-enough answer and also launch a run that is not expected to change it.

Make the task folder at intake, even for one lane:

```
.claude/tasks/<slug>/
  README.md      from readme-template.md; "What is asked" holds the ask word for word
  evidence/      briefs, lane runs, reports, validation proof, ticket-update.md
  review/        Lavish pages: questions, the agents board, the plan
```

Add one line for it to `.claude/tasks/INDEX.md`. No other files: the PRD and the task list are sections of the README.

### 2. Ask

A question with options, a tradeoff or evidence behind it goes on a Lavish QA page, never as a list in chat:

1. Read the playbooks first: `npx -y lavish-axi playbook input` (and `plan`, `table` or `comparison` as the page needs), and `npx -y lavish-axi design` for the default styling.
2. Write `review/questions-<topic>.html`. For each question: what is asked in one line, what makes it hard, the evidence (file and line, figure and source, URL), what you would pick and why, and what it costs to be wrong. Answers are native form controls that queue one prompt on submit.
3. `npx -y lavish-axi review/questions-<topic>.html`, put the session URL in chat, bold, on its own line, then `npx -y lavish-axi poll review/questions-<topic>.html` in the foreground until the user answers.

A one-line fact ("this branch or a new one?") stays in chat.
Ask only what would change what gets built. Record each answer under "Open questions" in the README with the page it was answered on.

**No Lavish** (`npx -y lavish-axi --help` fails, or this session runs headless): write the same questions to `.claude/tasks/<slug>/questions.md`, say so in chat, and wait for the answers.

Never run `lavish-axi share`: it publishes the page to a public host. Only on the user's word for that exact page.

### 3. PRD

Fill "The approach" in the README: goals, numbered requirements, non-goals, and how we know it worked.
Depth scales with the task; a one-line fix gets one line each.

### 4. Tasks

Fill "Tasks": checkboxes, each source file paired with its test, and which lane owns which file.
Decide here everything two lanes would otherwise decide differently, because a lane cannot ask:

- **File ownership.** Every file belongs to one lane or to the first mate.
- **Conventions.** Names, prefixes, string keys, API shapes: anything one lane writes and another reads.
- **Shared files.** If two lanes need one file, give each its own top-level key and merge at the join.
- **Ports and data.** One dev-server port per lane; test data is invented.

### 5. Go?

One gate, once, on scope: a Lavish page (`review/plan-<slug>.html`, playbook `plan`) with the PRD, the task list, the lanes, the member for each and why, and one go or no-go.
Without Lavish, the same in `questions.md`.
Skip it only when the user already gave the scope in so many words.

### 6. Board

The agents board opens before the first dispatch, and every lane of the task shows on it.

1. Write `evidence/lanes-<yyyy-mm-dd>.json`:

   ```json
   {
     "title": "<task name>",
     "plan": "<absolute path to the task README>",
     "lanes": [
       { "name": "a", "member": "<member>", "ship": "<ship or omit>", "job": "<the user's ask in one plain line>", "worktree": "<the folder the lane starts in>", "evidence": "<task>/evidence/lane-a", "brief": "<task>/evidence/brief-lane-a.md" }
     ]
   }
   ```

   `worktree` must be the folder the run is started in: the board finds the session log from it.
2. Build it, open it, post the link, then keep it fresh as a tracked background job (it stops once every lane has ended):

   ```bash
   B="${CLAUDE_SKILL_DIR}/board.js"
   node "$B" "<task>/evidence/lanes-<date>.json" "<task>/review/board-<date>.html"
   npx -y lavish-axi "<task>/review/board-<date>.html"
   node "$B" "<task>/evidence/lanes-<date>.json" "<task>/review/board-<date>.html" --watch 60   # run_in_background: true
   ```

3. Put the session URL in chat at once, bold, on its own line, and again in the final message of the turn.
4. A later lane on the same task: add it to the same JSON, rebuild, reopen the page if it was closed, restart the `--watch` job.
5. The board is info only: no questions on it. A decision a lane surfaces gets its own QA page (step 2).

**No Lavish:** the same command with a `.md` out path (`review/board-<date>.md`) writes a Markdown status file; point the user at it.

### 7. Lanes

**Pick the member.** `crew list` shows every member with its ship, email and organisation; a member is one Claude login in `<crewrota home>/members/<member>`, where the crewrota home is `CREWROTA_HOME`, else `~/.crewrota`.
In priority order:

1. **The user named one:** use it.
2. **Routing rules** in `.claude/crewrota.json`, `routing`: a list of `{ "work": "<which work, in words>", "members": ["<first choice>", "<next>"] }`. A rule whose `work` matches the task limits the pick to its members, tried in order.
3. **Quota.** Read every eligible member live, one call per member, side by side (a few seconds each, no message sent):

   ```bash
   CLAUDE_CONFIG_DIR="<crewrota home>/members/<member>" npx -y quota-axi --provider claude --json > "<task>/evidence/quota-<member>.json"
   ```

   - `providers[0].windows` holds `five_hour` and `seven_day`; percent used is `100 - percentRemaining`. A member has quota while both are under about 80% used.
   - One member per call. With several folders in one call, a member whose sign-in expired since its last session reads as `credentials_expired`; alone in a call it is renewed through Claude Code's own flow.
   - A status other than `fresh` is unknown quota: say so; the member stays eligible. The fallback reading is `<member folder>/quota.json`, written by that member's last interactive status line.
   - Skip the member this session runs on (its folder is this session's `CLAUDE_CONFIG_DIR`), and any member `crew list` shows on the same email and organisation: they share one quota.
   - A rule with an order takes the first member in it that has quota; otherwise prefer the most 5-hour headroom.
   - If every eligible member is tight, stop and put the choice to the user. Never drop quietly to a weaker model.

   State the pick in one line, with the numbers: "Lane a on review (16% of its 5-hour window used; build is at 89% of its week)."
4. **Model and effort: leave them alone.** `crew run` passes the member's remembered model and effort. Change them only when the user names one.

Preflight a member not used today, or after a login change: `crew run <member> -- -p "Reply with the single word READY and nothing else."`.

**Write one brief per lane** from `brief.md`, saved as `evidence/brief-lane-<name>.md`:

- `## Intent` holds the user's own words, verbatim, plus any boundary they stated. The check in step 8 treats it as the acceptance criteria, so never widen it into a general goal.
- `## Spec` holds only the build instructions that ask needs, and names what is out of scope.
- Give absolute paths for everything the lane must read; decide every open point in the brief, since a lane cannot ask.
- If the user adds to the ask mid-run, append their words to `## Intent` and carry them in the follow-up.

**Give every lane its own tree.** Every task in a git repo gets a leased tree, scouts included.

- With `treehouse` on PATH, from the repo:

  ```bash
  treehouse get --lease --json --lease-holder <member>:<slug> -b crew/<slug>    # ship
  treehouse get --lease --json --lease-holder <member>:<slug>                   # scout: detached, no branch
  ```

  It prints `path`, `lease_id`, `lease_holder`, `leased_at` and `base_branch`; record the `path` and `lease_id` in the README's Tasks section.
  Gitignored files a lane needs (a cut-down env file) are listed in the repo's `.worktreeinclude`, which treehouse copies on every acquire; never copy them by hand.
- Without treehouse, a plain worktree on its own branch beside the repo:

  ```bash
  git -C "<repo>" worktree add -b crew/<slug> "<repo>/../.worktrees/<slug>" <base branch>   # ship
  git -C "<repo>" worktree add --detach "<repo>/../.worktrees/<slug>" <base branch>         # scout
  ```

  A plain worktree holds only committed files: copy in any ignored file the lane needs, cut down to the values its tests use.
- Not a git repo: the lane works in place and the brief names the only files it may write.

**Dispatch** each lane as one Bash call with `run_in_background: true`, after the board is open:

```bash
E="<task>/evidence/lane-<name>"
mkdir -p "$E" && cd "<lane tree>" && crew run <member> -- -p "<one line naming the rules that apply>. Read the brief at <absolute path, forward slashes> and carry it out completely, start to finish, without stopping to ask anything." --output-format json > "$E/run.json" 2> "$E/run.err"
```

- `crew run` starts Claude in the folder it is run from, as that member, with its ship's history and MCP servers. Everything after `--` goes to Claude.
- A headless run cannot answer permission prompts: crew adds `--dangerously-skip-permissions` while `crew config show` says permissions are on. Say in the dispatch line that prompts are off, and keep the brief's write boundary tight.
- Keep the prompt to one short line pointing at the brief; a long multi-line argument can be cut on Windows. Put `MSYS_NO_PATHCONV=1` in front in Git Bash when an argument starts with `/`.
- **The background job is the supervision.** This session is re-invoked when the lane exits. Do not poll in a loop, and never report a result before the exit notification.
- The lanes are background jobs of this session: do not restart it while they run.

**Before calling a lane stuck,** check two things: is its session log still growing (the board's "Last activity", or the newest `.jsonl` under `<member folder>/projects/<lane tree with each non-alphanumeric character as ->/`), and has any file in its tree changed in the last ten minutes? A quiet log with fresh files is a lane writing code. Never kill a lane that is still writing.

**Follow up on an ended lane:** `run.json` carries `session_id`.

```bash
cd "<same tree>" && crew run <member> -- -p "<follow-up>" --resume <session_id> --output-format json > "$E/run-2.json" 2> "$E/run-2.err"
```

If that fails, start a fresh run in the same tree pointed at the brief, `git status` and the last report.

### 8. Validate

A lane's report is a claim, not proof. When a lane ends:

1. `run.json`: `is_error`, `result`, `num_turns`, `duration_ms`. Lines tagged `[i]` before the JSON are crewrota notes, not failures. A usage-limit stop reads "hit your session limit": the tree keeps what was done; finish it with a fresh run, on another member if this one is out.
2. Read `report.md`: its Deviations and its "Noticed and left alone" list first. That is where one lane names what another lane or the first mate must handle.
3. Read the diff (`git -C <tree> status`, `git -C <tree> diff`) against `## Intent`: exactly the ask, nothing wider.
4. Re-run one of its proof commands yourself.
5. Several lanes: join them on one branch (`git -C <tree> diff --binary HEAD` then `git apply`, plus the untracked files from `git ls-files --others --exclude-standard`), fix the cross-lane gaps the reports named, and run the joined proof. Each lane only proved its own half.

Then validate the change itself, picking the tool by what changed:

| Change | Validation | Proof in `evidence/` |
|---|---|---|
| Anything visible | Playwright CLI drives the real flow at desktop and mobile widths, one named session per lane (`playwright-cli -s=<slug>-<lane> open <url>`, or `PLAYWRIGHT_CLI_SESSION`); `playwright-cli show` watches them all | before and after screenshots, numbered by step |
| API, webhook, agent turn | the real request | request and response saved, not described |
| Library or CLI | the project's tests and lint, plus the command a user would run | test output, command output |
| Config, data, docs | read it back from the live system, check links | the read-back |

Anything not validated goes in the README's Validation section with the reason, never "should work".

### 9. Draft and write back

**The ticket update is drafted, never posted.** Write `evidence/ticket-update.md` with two comments:

- **For review:** what changed in two lines, the PR link and the preview link (copied from the output, never assembled from memory).
- **For QA:** numbered steps to check it, then the screenshots by file name, in step order.

Add these notes for whoever posts it: put screenshots inline in the comment, not in a thread reply; check the comment after posting, because tracker tools can report success and post nothing; to reword a comment with mentions, post the new one, then delete the old.
The user pastes it into their tracker; record the link they post it at under "Ticket updates" in the README.

**Write back what was learned.** Each gotcha found on the way becomes one memory in `.claude/memories/` (one fact per file with `name`, `description`, `type` frontmatter, plus a row in its README); update the memory it supersedes rather than adding a second.
A reusable procedure becomes a proposed skill in `.claude/skills/<name>/SKILL.md`, only on the user's yes.
Close the README: Files, Validation, Folder and a dated History line.

## Land and clean up, only on the user's word

- Ship work stays uncommitted in its tree until the user says what to do with it: commit, PR, or copy into the main tree. Commits, pushes and merges are this session's job, never a lane's, and only on the user's word. "Commit" means one plain commit.
- Never merge without the user's word for that merge.
- Return a tree only once nothing in it is unlanded: `git -C <tree> status --porcelain` is empty and `git log <base>..<branch>` shows nothing missing from the base. Then `treehouse return --if-lease-id <lease_id>` (from inside the tree), or `git worktree remove <path>` for a plain worktree. If either check is not empty, stop and report it: a refusal to discard is a finding, not an obstacle. Never `--force`.

## Report in outcomes

- Lead with what changed or what was found, then what it means, then any decision needed. The closing summary opens with a 60-second version.
- The final message of the turn stands alone: what finished, on which members, time, the board link, every PR or page URL copied verbatim from the output, and any decision needed.
- A decision with options goes on a Lavish QA page (step 2) and under "Open questions" in the README until answered. A single yes or no stays in chat.
- Failure is reported plainly, with the evidence.

## Precedence

A current, explicit instruction from the user beats any rule above, for exactly the action and object it names.
Never broaden it, carry it to another task, or turn it into a standing rule.
Destructive or irreversible steps still need the user to name the step.

## Failure signatures

| Symptom | Meaning | Do |
|---|---|---|
| `Crew member X doesn't exist` | No such member | `crew list`; the user adds it with `crew add <member>` and signs in |
| `config permissions on` in `run.err` | Skip-permissions not answered yet | `crew config permissions on`, on the user's word |
| `credentials_expired` in a quota reading | The member's sign-in expired since its last session | Read it alone (step 7); if it stays expired, the user runs `crew login <member>` |
| Empty `run.json`, or `is_error` with "hit your session limit" | Member out of quota | Wait for the reset or use another eligible member, same tree |
| Text before the JSON in `run.json` | crewrota notes | Parse the line that holds `"result"` |
| An argument like `/api/x` arrived as a Windows path | Git Bash path conversion | `MSYS_NO_PATHCONV=1` in front |
| The prompt arrived cut short | Long multi-line argument on Windows | One short line pointing at the brief file |
| `treehouse get` fails | treehouse missing or the pool is busy | `crew doctor`; fall back to a plain worktree and say so |
