#!/usr/bin/env node
// Stands in for Claude Code in tests and demos. It only writes inside CLAUDE_CONFIG_DIR and never touches a real account.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = process.env.CLAUDE_CONFIG_DIR;
if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, dir: dir ?? null }) + '\n');

if (args[0] === '--version') {
  console.log('2.1.310 (Claude Code) (fake)');
  process.exit(0);
}

if (args[0] === 'auth') {
  if (!dir) {
    console.error('fake claude: CLAUDE_CONFIG_DIR is not set');
    process.exit(2);
  }
  const file = path.join(dir, '.claude.json');
  const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
  const write = (data) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  };

  if (args[1] === 'login') {
    const code = Number(process.env.FAKE_CLAUDE_LOGIN_EXIT ?? 0);
    if (code !== 0) process.exit(code);
    const at = args.indexOf('--email');
    const email = at === -1 ? process.env.FAKE_CLAUDE_EMAIL ?? 'sam@example.com' : args[at + 1];
    const org = process.env.FAKE_CLAUDE_ORG ?? '';
    write({ ...read(), oauthAccount: { emailAddress: email, organizationName: org, organizationUuid: org ? `uuid-${org}` : '' } });
    process.exit(0);
  }
  if (args[1] === 'status') {
    const data = read();
    if (!fs.existsSync(file)) write({});
    const loggedIn = Boolean(data.oauthAccount) && !process.env.FAKE_CLAUDE_STATUS_EXIT;
    const configDirectory = process.env.FAKE_CLAUDE_CONFIG_DIRECTORY ?? dir;
    console.log(JSON.stringify({ loggedIn, authMethod: loggedIn ? 'claude.ai' : 'none', configDirectory }, null, 2));
    process.exit(loggedIn ? 0 : Number(process.env.FAKE_CLAUDE_STATUS_EXIT ?? 1));
  }
  if (args[1] === 'logout') {
    const data = read();
    delete data.oauthAccount;
    write(data);
    process.exit(0);
  }
  console.error(`fake claude: unsupported command: ${args.join(' ')}`);
  process.exit(2);
}

// A print run with stream-json reports usage the way Claude Code does, once, before the reply.
if (args.includes('-p') && args.includes('stream-json')) {
  console.log(JSON.stringify({ type: 'system', subtype: 'init' }));
  if (!process.env.FAKE_CLAUDE_NO_LIMITS) {
    const window = (pct, at) => ({ utilization: Number(pct) / 100, resetsAt: at, status: 'allowed' });
    const unifiedWindows = { five_hour: window(process.env.FAKE_CLAUDE_FIVE ?? 25, 1999990000), seven_day: window(process.env.FAKE_CLAUDE_WEEK ?? 40, 1999999000) };
    console.log(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows } }));
  }
  console.log(JSON.stringify({ type: 'result', result: 'ok' }));
  process.exit(0);
}

// A plain launch in a folder with no login plays Claude Code's first-run login, as crew add and crew login use it.
if (args.length === 0 && dir) {
  const file = path.join(dir, '.claude.json');
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (!data.oauthAccount) {
    const code = Number(process.env.FAKE_CLAUDE_LOGIN_EXIT ?? 0);
    if (code !== 0) process.exit(code);
    const org = process.env.FAKE_CLAUDE_ORG ?? '';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...data, oauthAccount: { emailAddress: process.env.FAKE_CLAUDE_EMAIL ?? 'sam@example.com', organizationName: org, organizationUuid: org ? `uuid-${org}` : '' } }, null, 2));
    process.exit(0);
  }
}

// Anything else is a session launch.
process.exit(Number(process.env.FAKE_CLAUDE_EXIT ?? 0));
