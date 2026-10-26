# <Ship | Scout> - Lane <name>: <one line: what this lane delivers>

<Which rules apply: the project's CLAUDE.md files, top down, and the two or three memories in `.claude/memories/` that matter.
If the member usually carries other work, say plainly that this task is not that work and which rules it must ignore.>

<You are one of <n> lanes working in parallel. The first mate collects the results and joins them.>
You run headless and cannot ask questions.
Where this brief is silent, choose <the stated default> and record it under Deviations in your report.

## Intent

<The user's ask, in their own words. Any boundary they stated. The substance of any report, PR or decision the ask points at.>

This section is the acceptance check. Do exactly this, nothing wider.

## Spec

1. `<file>` - <what, with the exact convention>.
2. `<file>` - <what>.

Conventions shared with the other lanes: <prefixes, key namespaces, API shape>.
Yours to own: <files>. Another lane's, do not create or edit: <files>.
Out of scope: <list>.
If you notice something worth doing outside this, write it under "Noticed and left alone" in your report and do not do it.

## Where you work

- Your tree: `<absolute path>` (branch `<crew/slug>`, or detached for a scout). First run `pwd -P` and `git rev-parse --show-toplevel`; if either prints `<main checkout path>`, stop and say so in your report. Start with `<install command>`.
- Your evidence folder: `<task>/evidence/lane-<name>/`.
- Write nowhere else. Never touch `<main checkout>`, the other lanes' trees, or the task `README.md`.
- No git writes at all: no commit, stash, branch switch, reset, clean or push. Leave your work uncommitted. No deploy, no publish.
- Never create, remove or prune a git worktree, and never stop or reset a shared service (database, container, a dev server on another port).
- Dev server on port <port> only. Browser checks with Playwright CLI in your own session: `playwright-cli -s=<slug>-<name> ...`.
- Env files: never print them, never copy a value from them into a file, a log or your report. Test data is invented.
- House style: <punctuation, comment density, language>.

## Read first

1. The task README: `<absolute path>`, sections "The approach" and "Tasks".
2. <absolute path> - <which part and why>.

## Proof - run it, save it to your evidence folder

- <checks that can pass or fail: requests and responses, screenshots at stated widths, test runs>
- `<typecheck>`, `<lint>`, `<build>`, `<tests>` pass. If the project has no test suite, say so.

## Hand back

Write `<task>/evidence/lane-<name>/report.md`.

Ship:

- files added, changed and removed
- what you proved, with the evidence file names
- what you did not test
- Deviations from this brief, and why
- Noticed and left alone, especially anything another lane or the first mate must handle

Scout:

- the answer first, in a few sentences
- the evidence behind it, with file paths, commands or URLs
- what is verified and what is inferred, labelled
- what you did not check
- A recommendation is not a go-ahead: change no project code. Anything you edited to find out is scratch.

End your run with a summary of at most 15 lines.
