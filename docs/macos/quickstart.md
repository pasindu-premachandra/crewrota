# crewrota quickstart for macOS (beta)

Five steps. Run the commands in Terminal.

## 1. Install Claude Code

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Or with Homebrew:

```bash
brew install --cask claude-code
```

Check it with `claude --version`.

## 2. Install Node.js 22 or newer

Download it from https://nodejs.org/en/download, then open a new Terminal window and check it with `node --version`.

## 3. Install crewrota

```bash
npm install -g crewrota
```

`crew`, `crw` and `crewrota` are then known commands in every terminal, all the same command.
Run it again to update. Remove it with `npm uninstall --global crewrota`.
Check the setup with `crew doctor`.

From source: in the crewrota folder:

```bash
sh scripts/install.sh
```

It checks for Node 22, builds crewrota, packs it the way it would be published, and installs that package globally.
Run the script again after pulling changes to update.

## 4. Add your crew members

```bash
crew add work
```

crew makes the folder `~/.crewrota/members/work` and runs Claude Code's own login inside it, so your browser opens to sign in.
Your main `~/.claude` login is not touched.
Then crew shows the email and organisation it logged in as, and asks whether to share history with other members.
Every member gets your skills, agents, commands, plugins, settings and `CLAUDE.md` from `~/.claude`, and its MCP servers from its ship.
Add as many members as you have accounts, for example `crew add personal`.

## 5. Share history, then start Claude

```bash
crew ship join work team
crew ship join personal team
crew
```

The menu shows your members with their 5-hour and weekly bars, and the ship, model and effort below them.
Up and down move, left and right change the ship, the model or the effort, enter starts, esc quits; each member starts on its own ship and its last model and effort.
The bars show each member's last reading and fill after its first session. Each time the menu opens it reads them fresh with quota-axi, one call per member side by side, and sends no message; `crew config refresh off` stops that, and the bars then show each member's last reading.
`crew warmup` sends each member one short Haiku message, which starts its 5-hour window if none is running.
Or skip the menu with `crew work` (short for `crew run work`).
At your first launch crewrota asks once whether sessions should start with `--dangerously-skip-permissions` (default no).
If something is missing, `crew doctor` says what and how to fix it.

## 6. Install the default tools and the plugin

```bash
crew setup
```

It lists each tool (the lavish, gh-axi and quota-axi skills, treehouse, Playwright CLI, and the Playwright MCP entry for each ship) with the exact command it runs and where it lands, then asks once.
Anything already installed is skipped.
It also asks whether lavish-axi may send usage telemetry, and checks `gh auth status` without signing you in.
`crew doctor` shows what is still missing.

Then add the plugin in your main Claude Code (not inside a member; members pick it up at their next launch):

```bash
claude plugin marketplace add pasindu-premachandra/crewrota
claude plugin install crewrota@crewrota
```

## 7. Set up a project and run firstmate

In the project's folder:

```bash
crew init
```

It writes `.claude/` (`crewrota.json`, a short `CLAUDE.md` if the project has none, `memories/`, `skills/`, `tasks/INDEX.md`) and never overwrites a file.
Then start Claude in that folder and hand it a task: `/firstmate <what you want done>`.

## Menu bar (optional)

Beta.
crewrota ships one plugin file, `crewrota.1m.sh`, that puts every member's 5-hour and week use in the menu bar and refreshes it every minute.
It runs `crew quota --format menubar`, which only reads each member's last reading and never sends a message.

Install SwiftBar (macOS 12 or newer) and open it once; it asks you to pick its plugin folder:

```bash
brew install swiftbar
```

Copy the plugin file into that folder and make it executable (here the folder is `~/SwiftBar`):

```bash
cp "$(npm root --global)/crewrota/widget/crewrota.1m.sh" ~/SwiftBar/
chmod +x ~/SwiftBar/crewrota.1m.sh
```

The menu bar shows `crew` and the current member's 5-hour use, for example `crew 42%`.
Click it for each member's 5-hour and week use with their reset times, green under 60%, amber from 60% and red from 80%, then "Open the crew menu" and "Refresh".
xbar reads the same file from its own plugin folder.
