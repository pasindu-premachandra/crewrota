#!/usr/bin/env node
// SessionStart hook: Claude Code adds this plain stdout to the session's context. Prints nothing when crewrota's config says lavishRule: false.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The same folder as crewrota's src/paths.ts configDir().
function configFile() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'crewrota', 'config.json');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, 'crewrota', 'config.json');
}

const RULE = `crewrota rule for this session (from the crewrota plugin; the user turns it off with: crew config lavish off)
- A question with options, a tradeoff or evidence behind it goes on a Lavish QA page in the task's review/ folder (npx -y lavish-axi <file>), never as a list in chat. A one-line fact or a single yes or no stays in chat.
- firstmate opens the agents board before its first dispatch, and posts the board's link in chat.
- Never run lavish-axi share (it publishes to a public host) without the user's word for that page.
- No Lavish (not installed, or a headless session): write the questions to the task's questions.md, say so in chat, and wait for the answers.`;

let off = false;
try {
  off = JSON.parse(fs.readFileSync(configFile(), 'utf8')).lavishRule === false;
} catch {
  // no config yet, or one that cannot be read: the rule stays on
}
if (!off) console.log(RULE);
