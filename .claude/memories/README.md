# Project memories

Memory files for any Claude Code session working in this repo.
One fact per file, with YAML frontmatter (`name`, `description`, `type` of `user` | `feedback` | `project` | `reference`); cross-link with `[[slug]]`.
Every new memory gets a row here.

| File | Type | Summary |
|---|---|---|
| [release-plan.md](release-plan.md) | project | Release decisions and the push-day checklist live in the gitignored `.claude/tasks/github-release/README.md`; nothing is committed, pushed or published without the owner's word |
| [vscode-terminal-contrast-block-elements.md](vscode-terminal-contrast-block-elements.md) | reference | VS Code's terminal lightens dark glyphs to its minimum contrast but not block elements (U+2580 to U+259F); why the usage bars use `▖` |

**Note on secrets:** this folder is tracked by git. Never put API keys, tokens, credentials or private denylist terms here; keep them in `.env` (gitignored) or local auto-memory.
