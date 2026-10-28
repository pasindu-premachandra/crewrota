# crewrota - dev guide

crewrota is a Node/TypeScript CLI (`crewrota`, `crw`, `crew`) that runs Claude Code as one of the user's crew members.
A crew member is one Claude login in its own config folder (`CLAUDE_CONFIG_DIR`), logged in through Claude Code's own first-run login (plain `claude` in the member folder; `claude auth login` only with `--email`/`--sso`); a ship is the `projects/` and session folders several members share through links, plus the ship's own MCP servers.
crewrota owns the member folders, the ships, the menu, the remembered model and effort, the skip-permissions answer and the shared items from the main setup.
Stable (1.0.2), MIT; the npm package `crewrota` ships `dist/` (no tests), `templates/` and `widget/` (`files` in `package.json`), and the plugin installs from the GitHub repo `pasindu-premachandra/crewrota`. Personal venture under `E:\Projects\startup`; that folder's `CLAUDE.md` applies.

## Layout

```
src/cli.ts        argv parsing and the commands (hand-written, no CLI framework)
src/members.ts    the creation workflow, use, add, rename, remove
src/menu.ts       the one-screen crew menu (@clack/core), crew quota's lines, and the @clack/prompts questions
src/launch.ts     builds the claude argv, heals links, starts claude in the member folder
src/ships.ts      ships: join, heal, leave, rename
src/backup.ts     crew backup and crew restore: one zip through bsdtar, the project slug and remap rule, the tar runner
src/shared.ts     shared items from the main ~/.claude: links, copies, mcpServers
src/links.ts      link helpers, folder moves to removed/, session file counts
src/rows.ts       member rows for the menu and list, quota.json readings
src/statusline.ts the status line given to members without one: writes quota.json, prints the main setup's layout (model, context, branch, 5h, 7d, reset, folder, crew member)
src/shortcuts.ts  crew shortcut: VS Code workspace files under shortcuts/, the Start Menu .lnk, the Code.exe lookup
src/widget.ts     crew widget: opens widget/crewrota-widget.pyw with pythonw, asks it to close through widget.close, the Startup shortcut
widget/           the quota widget (Python + Tk), shipped in the npm package
templates/dot-claude/  the root .claude/ that crew init writes (crewrota.json marks the root)
.claude-plugin/   marketplace.json: one plugin, crewrota, from ./plugin
plugin/           the Claude Code plugin: .claude-plugin/plugin.json, skills/firstmate/ (SKILL.md, brief.md, readme-template.md, board.js), hooks/ (hooks.json, lavish-rule.mjs)
widget/crewrota.1m.sh  the SwiftBar/xbar menu bar plugin: runs crew quota --format menubar (macOS, beta)
src/say.ts        the site palette (painter, paint, paintError: 24-bit, named-colour fallback, plain when piped) and [i] / [!] / [OK] tags
src/identity.ts   email and organisation from a member's .claude.json
src/claude.ts     the only place that runs claude and quota-axi
src/doctor.ts     setup checks with per-OS fixes
src/setup.ts      crew setup: the default tools from upstream, one list, one yes, one injectable runner; crew doctor's tool lines
src/init.ts       crew init: writes templates/dot-claude/ into the current folder's .claude/, never overwriting a file
src/config.ts     the remembered config (APPDATA or XDG_CONFIG_HOME, crewrota/config.json)
src/paths.ts      config, crewrota home, member, ship and main-setup paths
src/names.ts      member and ship name rule
src/test/         node:test tests, fixtures/ holds the fake claude
scripts/          install.ps1 and install.sh (global install from a packed build), check-private.mjs (denylist scan), hooks/pre-push
docs/             windows/ and macos/ quickstarts (macOS is beta)
```

## Commands

```
npm install
npm run build          # tsc, src/ to dist/
npm run typecheck
npm test               # build, then node --test over dist/test
npm run check:private  # scan tracked and new files against the private denylist
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1   # Windows: install crew, crw, crewrota globally (sh scripts/install.sh elsewhere)
```

Try the CLI without real accounts: set `CREWROTA_CLAUDE=src/test/fixtures/fake-claude.mjs` and `CREWROTA_HOME` to a temp folder, then `node dist/cli.js list`.

## How it uses Claude Code

- Usage: the menu and `crew quota` run quota-axi (a pinned dependency, started with node from `node_modules`, never npx) with `--provider claude --json` once per member, side by side, with `CLAUDE_CONFIG_DIR` set to the member folder and `QUOTA_AXI_CLAUDE_PROFILES` removed (several folders in one call read idle members as `credentials_expired`), and save a `fresh` reading to `quota.json`; `CREWROTA_QUOTA_AXI` points at another quota-axi, such as the tests' fake.
- Status line: a member whose `settings.json` has no `statusLine` gets `crewrota statusline` at launch, which saves the session's `rate_limits` to `quota.json` in the member folder; it is the fallback when quota-axi gives no reading.
- `crew warmup` is the only command that sends a message: one short Haiku print run per member (`probeRateLimits`), which starts its 5-hour window if none is running.
- Calls: `claude --version`, plain `claude` for a new member's login (pastes work there; `claude auth login` did not take a pasted code in Git Bash inside VS Code, 26 Oct 2026), `claude auth login [--email <e>] [--sso]`, `claude auth logout`, `claude auth status --json`, and the session launch `claude [--model] [--effort] [--dangerously-skip-permissions] [args]`, each with `CLAUDE_CONFIG_DIR` set to the member folder (except `--version`).
- A member is `<crewrota home>/members/<member>`; the crewrota home is `CREWROTA_HOME`, else `~/.crewrota`.
- A ship is `<crewrota home>/ships/<ship>/` with `projects`, `todos`, `file-history`, `session-env` and `shell-snapshots` (`SHIP_FOLDERS`); each member on it links those five to the ship with a junction (Windows) or symlink, and its `mcp.json` (keys included) is copied into each member's `.claude.json` at launch.
- Every member links `skills`, `agents`, `commands` and the `cache`, `data` and `marketplaces` of `plugins/` to `~/.claude`, and gets copies of `settings.json`, `CLAUDE.md` and the plugin lists; `known_marketplaces.json` is copied with its paths pointed at the member, as ccs does.
- Email and organisation come from `oauthAccount.emailAddress`, `organizationName` and `organizationUuid` in the member's `.claude.json`.
- Settings are keyed by member name.
- Backups: `crew backup` and `crew restore` run bsdtar, never the `tar` on PATH on Windows (Git Bash's is GNU tar, which cannot write a zip): `%SystemRoot%\System32\tar.exe` there, else `bsdtar` or a `tar` whose `--version` names bsdtar (Linux: `libarchive-tools`); `CREWROTA_TAR` points at another. A password adds AES-256 zip encryption. Logins and member folders are never in a backup.

## Hard rules

- Never read, copy or print a credential file: any `.credentials.json`, `.env*`.
- Never write to the main `~/.claude` or `~/.claude.json`; they are read only, for the shared items.
- Tests never call the real `claude` or the real quota-axi. Use the fakes (`CREWROTA_CLAUDE`, `CREWROTA_QUOTA_AXI`) or an injected runner, and call `isolate()` from `src/test/helpers.ts` so HOME, USERPROFILE, APPDATA, XDG_CONFIG_HOME and CREWROTA_HOME point at temp folders.
- Never a recursive delete through a link. Members and ships are moved to `removed/` after their links are unlinked; only a folder crewrota made moments ago in a failed creation, with no link in it, is deleted.
- No em dash and no en dash anywhere; plain hyphens.
- Comments only where the code is not obvious, one short line.
- Do not commit during feature work; no commit trailers. The denylist lives outside the repo; never copy its terms into a file.

## Context layer

`.claude/memories/` holds one fact per file with a row in its `README.md`; `.claude/tasks/<slug>/readme.md` per effort (gitignored).
