# crewrota quickstart for Windows

Five steps. Run the commands in PowerShell.

## 1. Install Claude Code

```powershell
irm https://claude.ai/install.ps1 | iex
```

Or with winget:

```powershell
winget install Anthropic.ClaudeCode
```

Check it with `claude --version`.

## 2. Install Node.js 22 or newer

Download it from https://nodejs.org/en/download, then open a new PowerShell window and check it with `node --version`.

## 3. Install crewrota

For now crewrota is installed from its repo, not from npm. In the crewrota folder, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

`-ExecutionPolicy Bypass` applies to that one run only; Windows blocks `.ps1` scripts by default.

It checks for Node 22, builds crewrota, packs it the way it would be published, and installs that package globally.
`crew`, `crw` and `crewrota` are then known commands in every terminal, all the same command.
Run the script again after pulling changes to update. Remove it with `npm uninstall --global crewrota`.
Check the setup with `crew doctor`.

## 4. Add your crew members

```powershell
crew add work
```

crew makes the folder `%USERPROFILE%\.crewrota\members\work` and runs Claude Code's own login inside it, so your browser opens to sign in.
Your main `~/.claude` login is not touched.
Then crew shows the email and organisation it logged in as, and asks one question:

- "Share history with other members?" Keep it isolated (the default), join an existing ship, or create a ship.

Every member gets your skills, agents, commands, plugins, settings and `CLAUDE.md` from `~/.claude` before every launch, and its MCP servers from its ship (`crew ship mcp list <ship>`).

Add as many members as you have accounts, for example `crew add personal`.
For a work account that signs in with single sign-on, use `crew add work --sso`.
`crew use <member>` also offers to create a member that does not exist yet.

## 5. Share history, then start Claude

To let two members see each other's sessions (`--resume`), put them on one ship:

```powershell
crew ship join work team
crew ship join personal team
```

crew asks before it creates a ship that does not exist, and copies each member's existing history into it.

Then start Claude:

```powershell
crew
```

The menu shows your members with their 5-hour and weekly bars, and the ship, model and effort below them.
Up and down move, left and right change the ship, the model or the effort, enter starts, esc quits; each member starts on its own ship and its last model and effort.
The bars show each member's last reading and fill after its first session. Each time the menu opens it reads them fresh with quota-axi, one call per member side by side, and sends no message; `crew config refresh off` stops that, and the bars then show each member's last reading.
`crew warmup` sends each member one short Haiku message, which starts its 5-hour window if none is running.
Or skip the menu with `crew work` (short for `crew run work`), or make one member the default with `crew use work` and run `crew run`.
At your first launch crewrota asks once whether sessions should start with `--dangerously-skip-permissions` (default no).
If something is missing, `crew doctor` says what and how to fix it.

## 6. Keep the bars on your desktop

```powershell
crew widget                  # open it; drag it anywhere, right-click to warm up, refresh or quit
crew widget close            # close it
crew widget startup on       # open it at every login (off removes that)
```

The widget is a small always-on-top window with every member's 5-hour and week bars, read from the same files as `crew quota`.
It needs Python 3 with Tk; the python.org installer includes both.

## 7. Install the default tools and the plugin

```powershell
crew setup
```

It lists each tool (the lavish, gh-axi and quota-axi skills, treehouse, Playwright CLI, and the Playwright MCP entry for each ship) with the exact command it runs and where it lands, then asks once.
Anything already installed is skipped.
It also asks whether lavish-axi may send usage telemetry, and checks `gh auth status` without signing you in.
`crew doctor` shows what is still missing.

Then add the plugin in your main Claude Code (not inside a member; members pick it up at their next launch):

```powershell
claude plugin marketplace add <owner>/crewrota
claude plugin install crewrota@crewrota
```

## 8. Set up a project and run firstmate

In the project's folder:

```powershell
crew init
```

It writes `.claude\` (`crewrota.json`, a short `CLAUDE.md` if the project has none, `memories\`, `skills\`, `tasks\INDEX.md`) and never overwrites a file.
Then start Claude in that folder and hand it a task: `/firstmate <what you want done>`.
