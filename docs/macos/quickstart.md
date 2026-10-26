# crewrota quickstart for macOS (beta)

Beta: these steps have not yet been run on a real Mac.
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

For now crewrota is installed from its repo, not from npm. In the crewrota folder:

```bash
sh scripts/install.sh
```

It checks for Node 22, builds crewrota, packs it the way it would be published, and installs that package globally.
`crew`, `crw` and `crewrota` are then known commands in every terminal, all the same command.
Run the script again after pulling changes to update. Remove it with `npm uninstall --global crewrota`.
Check the setup with `crew doctor`.

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
The bars show each member's last reading and fill after its first session. Each time the menu opens it checks them first, with one short message per member (on a member with no open 5-hour window, that message starts one); `crew config refresh off` stops that, and the bars then show each member's last reading.
Or skip the menu with `crew work` (short for `crew run work`).
At your first launch crewrota asks once whether sessions should start with `--dangerously-skip-permissions` (default no).
If something is missing, `crew doctor` says what and how to fix it.
