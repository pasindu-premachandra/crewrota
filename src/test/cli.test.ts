import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, saveConfig } from '../config.js';
import { linkState } from '../links.js';
import { memberDir, removedDir, shipDir, shipProjectsDir } from '../paths.js';
import { quotaAxiCommand } from '../claude.js';
import { readQuota } from '../rows.js';
import { cliPath, fakeMember, isolate, readLog } from './helpers.js';

const root = isolate();
const log = path.join(root, 'fake-claude.log');

function cli(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, FAKE_CLAUDE_LOG: log, ...env },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function launches() {
  return readLog(log).filter((call) => call.args[0] !== 'auth' && call.args[0] !== '--version');
}

test('--version prints the package version and --help lists the commands', () => {
  assert.equal(cli(['--version']).out.trim(), '0.3.3');
  const help = cli(['--help']).out;
  for (const command of ['crew use <member>', 'crew use -', 'crew add <member>', 'crew run [<member>]', 'crew list', 'crew whoami', 'crew current',
    'crew login <member>', 'crew rename', 'crew drop', 'crew ship create', 'crew ship join', 'crew ship leave', 'config permissions on|off', 'crew doctor',
    'crew quota', 'crew warmup [<member>...]', 'crew setup [--yes] [--with-hooks]', 'crew init', 'config lavish on|off']) {
    assert.ok(help.includes(command), command);
  }
  assert.doesNotMatch(help, /cswap|claude-swap|seat/);
});

test('list with no members says so and points at crew add', () => {
  const { code, out } = cli(['list']);
  assert.equal(code, 0);
  assert.equal(out.trim(), 'No crew members yet. Add one with: crew add <member>');
  assert.equal(fs.existsSync(process.env.CREWROTA_HOME!), false);
});

test('quota with no members says so and points at crew add', () => {
  const { code, out } = cli(['quota']);
  assert.equal(code, 0);
  assert.equal(out.trim(), 'No crew members yet. Add one with: crew add <member>');
});

test('current exits 1 with no output when there is no current member', () => {
  assert.deepEqual([cli(['current']).code, cli(['current']).out], [1, '']);
});

test('add and use of a missing member refuse without a terminal, after checking the name', () => {
  assert.match(cli(['add', 'Work']).err, /not a valid crew member name/);
  assert.match(cli(['add', 'work']).err, /Adding a crew member needs a terminal/);
  assert.match(cli(['use', 'work']).err, /Crew member work doesn't exist\. Creating it needs a terminal\. Run crew add work in a terminal\./);
  assert.equal(fs.existsSync(memberDir('work')), false);
});

test('list shows one row per member: * on the current one, ship, usage with its age, email and organisation', () => {
  const config = loadConfig();
  fakeMember(config, 'work', { email: 'sam.work@example.org', org: 'Example Org', ship: 'team' });
  fakeMember(config, 'home', { email: 'sam@example.com' });
  fakeMember(config, 'projects', { email: 'sam@example.com' });
  config.current = 'work';
  saveConfig(config);
  const now = Math.floor(Date.now() / 1000);
  fs.writeFileSync(path.join(memberDir('work'), 'quota.json'), JSON.stringify({ ts: now - 7200, five_hour_pct: 61, seven_day_pct: '23.6' }));

  const { code, out } = cli(['list']);
  assert.equal(code, 0);
  assert.deepEqual(out.trimEnd().split(/\r?\n/), [
    '   home      isolated  no reading yet             sam@example.com (personal)',
    '   projects  isolated  no reading yet             sam@example.com (personal)',
    '*  work      team      5h 61%  7d 24%  (2 h ago)  sam.work@example.org (Example Org)',
  ]);
  assert.equal(cli(['ls']).out, out);
  assert.equal(cli(['current']).out.trim(), 'work');
});

test('run passes the remembered model and effort, then the extra args, with CLAUDE_CONFIG_DIR set to the member', () => {
  const config = loadConfig();
  config.skipPermissions = false;
  config.members.work.model = 'opus';
  config.members.work.effort = 'high';
  saveConfig(config);

  assert.equal(cli(['run', 'work', '--', '--resume']).code, 0);
  assert.deepEqual(launches().at(-1), { args: ['--model', 'opus', '--effort', 'high', '--resume'], dir: memberDir('work') });
  assert.equal(linkState(path.join(memberDir('work'), 'projects'), shipProjectsDir('team')), 'ok');
  assert.equal(loadConfig().lastModel, 'opus');
});

test('run picks the member from the argument, then CREW_MEMBER, then the current member', () => {
  cli(['run', 'home'], { CREW_MEMBER: 'projects' });
  assert.equal(launches().at(-1)!.dir, memberDir('home'));
  cli(['run'], { CREW_MEMBER: 'projects' });
  assert.equal(launches().at(-1)!.dir, memberDir('projects'));
  cli(['run', '--', '--resume']);
  assert.deepEqual(launches().at(-1), { args: ['--model', 'opus', '--effort', 'high', '--resume'], dir: memberDir('work') });
});

test('crew <member> launches that member like crew run, and an unknown word is still an unknown command', () => {
  assert.equal(cli(['work', '--', '--resume']).code, 0);
  assert.deepEqual(launches().at(-1), { args: ['--model', 'opus', '--effort', 'high', '--resume'], dir: memberDir('work') });
  assert.equal(linkState(path.join(memberDir('work'), 'projects'), shipProjectsDir('team')), 'ok');
  const { code, err } = cli(['nobody']);
  assert.equal(code, 1);
  assert.match(err, /Unknown command: nobody/);
});

test('run exits with the exit code of claude, and refuses an unknown member', () => {
  assert.equal(cli(['run', 'home'], { FAKE_CLAUDE_EXIT: '7' }).code, 7);
  const { code, err } = cli(['run', 'nobody']);
  assert.equal(code, 1);
  assert.match(err, /Crew member nobody doesn't exist\. Create it with: crew add nobody/);
});

test('run with no member anywhere tells the user to run crew use', () => {
  const config = loadConfig();
  delete config.current;
  saveConfig(config);
  const { code, err } = cli(['run']);
  assert.equal(code, 1);
  assert.match(err, /crew use <member>/);
  config.current = 'work';
  saveConfig(config);
});

test('run without a terminal refuses until skip-permissions has been answered', () => {
  const config = loadConfig();
  config.skipPermissions = null;
  saveConfig(config);
  const before = launches().length;
  const { code, err } = cli(['run', 'work']);
  assert.equal(code, 1);
  assert.match(err, /config permissions on/);
  assert.equal(launches().length, before);
  assert.equal(cli(['config', 'permissions', 'off']).code, 0);
  assert.equal(loadConfig().skipPermissions, false);
});

test('use switches without launching, and use - goes back', () => {
  const before = readLog(log).length;
  assert.match(cli(['use', 'home']).out, /Now using home\./);
  assert.match(cli(['use', '-']).out, /Now using work\./);
  assert.equal(loadConfig().previous, 'home');
  assert.equal(readLog(log).length, before);
});

test('whoami shows the current member and its login state from claude auth status', () => {
  const { code, out } = cli(['whoami']);
  assert.equal(code, 0);
  assert.match(out, /Crew member: {2}work/);
  assert.ok(out.includes(`Folder:       ${memberDir('work')}`));
  assert.match(out, /Ship: {9}team/);
  assert.match(out, /Email: {8}sam\.work@example\.org/);
  assert.match(out, /Organisation: Example Org/);
  assert.match(out, /Logged in: {4}yes/);
  assert.deepEqual(readLog(log).at(-1), { args: ['auth', 'status', '--json'], dir: memberDir('work') });
});

test('login and logout run claude auth in the member folder, which stays', () => {
  assert.equal(cli(['logout', 'home']).code, 0);
  assert.deepEqual(readLog(log).at(-1), { args: ['auth', 'logout'], dir: memberDir('home') });
  assert.equal(cli(['login', 'home', '--email', 'sam@example.com']).code, 0);
  assert.deepEqual(readLog(log).at(-1), { args: ['auth', 'login', '--email', 'sam@example.com'], dir: memberDir('home') });
  assert.ok(fs.existsSync(memberDir('home')));
  const plain = cli(['login', 'home']);
  assert.equal(plain.code, 0);
  assert.deepEqual(readLog(log).at(-1), { args: [], dir: memberDir('home') });
  assert.match(plain.out, /type \/exit to come back/);
});

test('ship mcp adds, lists and removes a ship\'s servers, and never prints a key', () => {
  cli(['ship', 'create', 'keys']);
  assert.match(cli(['ship', 'mcp', 'add', 'keys', 'stripe', '--url', 'https://mcp.stripe.com/mcp?token=SECRET1', '--header', 'Authorization: Bearer SECRET2']).out, /Added stripe to ship keys/);
  assert.match(cli(['ship', 'mcp', 'add', 'keys', 'local', '--env', 'API_KEY=SECRET3', '--', 'npx', '-y', 'some-mcp']).out, /Added local/);
  const listed = cli(['ship', 'mcp', 'list', 'keys']).out;
  assert.match(listed, /stripe {2}http {2}https:\/\/mcp\.stripe\.com\/mcp/);
  assert.match(listed, /local {2}stdio {2}npx \(\+2 args\)/);
  assert.doesNotMatch(listed, /SECRET/);
  const saved = JSON.parse(fs.readFileSync(path.join(shipDir('keys'), 'mcp.json'), 'utf8')).mcpServers;
  assert.deepEqual(saved.stripe.headers, { Authorization: 'Bearer SECRET2' });
  assert.deepEqual(saved.local, { type: 'stdio', command: 'npx', args: ['-y', 'some-mcp'], env: { API_KEY: 'SECRET3' } });
  assert.match(cli(['ship', 'mcp', 'remove', 'keys', 'stripe']).out, /Removed stripe/);
  assert.match(cli(['ship', 'mcp', 'remove', 'keys', 'stripe']).err, /has no MCP server stripe/);
  assert.match(cli(['ship', 'mcp', 'add', 'keys', 'half']).err, /Give --url <url> for an HTTP server/);
  assert.match(cli(['ship', 'mcp', 'list', 'nowhere']).err, /Ship nowhere doesn't exist/);

  const seat = path.join(root, 'seat.claude.json');
  fs.writeFileSync(seat, JSON.stringify({ oauthAccount: { emailAddress: 'x@example.com' }, mcpServers: { vtex: { type: 'http', url: 'https://example.com/vtex' } } }));
  assert.match(cli(['ship', 'mcp', 'add', 'keys', 'vtex', '--from', seat]).out, /Added vtex/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(shipDir('keys'), 'mcp.json'), 'utf8')).mcpServers.vtex, { type: 'http', url: 'https://example.com/vtex' });
  assert.match(cli(['ship', 'mcp', 'add', 'keys', 'missing', '--from', seat]).err, /has no MCP server missing/);
});

test('ship import copies a folder\'s history into the ship and says what it did', () => {
  const group = path.join(root, 'group');
  fs.mkdirSync(path.join(group, 'projects', 'E--code'), { recursive: true });
  fs.writeFileSync(path.join(group, 'projects', 'E--code', 'a.jsonl'), 'a');
  const { code, out } = cli(['ship', 'import', 'keys', '--from', group]);
  assert.equal(code, 0);
  assert.match(out, /projects +1 copied, 0 brought up to date, 0 already there, 0 kept beside a changed copy/);
  assert.equal(fs.readFileSync(path.join(shipDir('keys'), 'projects', 'E--code', 'a.jsonl'), 'utf8'), 'a');
  assert.match(cli(['ship', 'import', 'keys', '--from', path.join(root, 'nope')]).err, /is not a folder/);
  assert.match(cli(['ship', 'import', 'keys']).err, /Usage: crew ship import/);
});

test('ship create, link, list, unlink and rename work through the command line', () => {
  assert.equal(cli(['ship', 'create', 'solo']).code, 0);
  assert.match(cli(['ship', 'create', 'solo']).err, /Ship solo already exists/);
  assert.equal(cli(['ship', 'join', 'home', 'solo']).code, 0);
  assert.equal(linkState(path.join(memberDir('home'), 'projects'), shipProjectsDir('solo')), 'ok');
  assert.match(cli(['ship', 'join', 'home', 'missing']).err, /Ship missing doesn't exist\. Creating it needs a terminal/);

  const listed = cli(['ship', 'list']).out;
  assert.match(listed, /^solo: home$/m);
  assert.match(listed, /^team: work$/m);

  assert.equal(cli(['ship', 'rename', 'solo', 'duo']).code, 0);
  assert.equal(linkState(path.join(memberDir('home'), 'projects'), shipProjectsDir('duo')), 'ok');
  assert.equal(loadConfig().members.home.ship, 'duo');

  assert.equal(cli(['ship', 'leave', 'home']).code, 0);
  assert.equal(loadConfig().members.home.ship, undefined);
  assert.equal(linkState(path.join(memberDir('home'), 'projects'), shipProjectsDir('duo')), 'not-a-link');
});

test('ship delete refuses while members are linked; --force unlinks them first, then moves the folder', () => {
  fs.writeFileSync(path.join(shipProjectsDir('team'), 'kept.jsonl'), 'history');
  const refused = cli(['ship', 'delete', 'team', '--yes']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /Ship team still has members aboard: work/);
  assert.ok(fs.existsSync(shipDir('team')));

  const forced = cli(['ship', 'delete', 'team', '--force', '--yes']);
  assert.equal(forced.code, 0, forced.err);
  assert.equal(fs.existsSync(shipDir('team')), false);
  assert.equal(loadConfig().members.work.ship, undefined);
  assert.equal(linkState(path.join(memberDir('work'), 'projects'), shipProjectsDir('team')), 'not-a-link');
  const moved = fs.readdirSync(removedDir()).find((name) => name.startsWith('ship-team-'))!;
  assert.equal(fs.readFileSync(path.join(removedDir(), moved, 'projects', 'kept.jsonl'), 'utf8'), 'history');
});

test('remove refuses the current member without --force, and needs --yes without a terminal', () => {
  assert.match(cli(['drop', 'work', '--yes']).err, /work is the current crew member/);
  assert.match(cli(['remove', 'projects']).err, /Pass --yes/);
  const { code, out } = cli(['drop', 'projects', '--yes']);
  assert.equal(code, 0);
  assert.match(out, /Session files in its projects folder: 0/);
  assert.match(out, /Dropped crew member projects\. Its folder is kept at .*removed.projects-\d{8}-\d{4}/);
  assert.equal(fs.existsSync(memberDir('projects')), false);
});

test('rename renames the folder and the current member', () => {
  assert.equal(cli(['rename', 'work', 'job']).code, 0);
  assert.equal(loadConfig().current, 'job');
  assert.ok(fs.existsSync(memberDir('job')));
  assert.match(cli(['rename', 'job', 'home']).err, /Crew member home already exists/);
});

test('config show lists the remembered settings', () => {
  const out = cli(['config', 'show']).out;
  assert.match(out, /--dangerously-skip-permissions: off/);
  assert.match(out, /Current member: job, previous: home/);
  assert.match(out, /job: model opus, effort high, isolated$/m);
});

test('the usage check is on by default; config refresh off stops it and on says it sends no message', () => {
  assert.match(cli(['config', 'show']).out, /Usage check when the menu opens: on/);
  cli(['config', 'refresh', 'off']);
  assert.equal(loadConfig().refreshReadings, false);
  assert.match(cli(['config', 'show']).out, /Usage check when the menu opens: off/);
  const on = cli(['config', 'refresh', 'on']);
  assert.equal(on.code, 0);
  assert.match(on.out, /reads every member's usage with quota-axi/);
  assert.match(on.out, /no message is sent/);
  assert.match(cli(['config', 'show']).out, /Usage check when the menu opens: on/);
  assert.match(cli(['config', 'refresh']).err, /config refresh on\|off/);
});

const probes = () => readLog(log).filter((call) => call.args.includes('-p'));

test('quota-axi runs with node from the copy crewrota ships with, never through npx', () => {
  const saved = process.env.CREWROTA_QUOTA_AXI;
  delete process.env.CREWROTA_QUOTA_AXI;
  try {
    const [command, args] = quotaAxiCommand();
    assert.equal(command, process.execPath);
    assert.match(args[0], /quota-axi[\\/]dist[\\/]bin[\\/]quota-axi\.js$/);
    assert.ok(fs.existsSync(args[0]));
    assert.deepEqual(args.slice(1), ['--provider', 'claude', '--json']);
  } finally {
    process.env.CREWROTA_QUOTA_AXI = saved;
  }
});

test('quota reads every member with quota-axi in its own folder, sends no message, then shows the bars; refresh off reads nothing', () => {
  const quotaLog = path.join(root, 'fake-quota-axi.log');
  const before = probes().length;
  const { code, out } = cli(['quota'], { FAKE_QUOTA_LOG: quotaLog, QUOTA_AXI_CLAUDE_PROFILES: 'x;y' });
  const names = Object.keys(loadConfig().members);
  assert.equal(code, 0);
  assert.equal(probes().length, before);
  assert.deepEqual(readLog(quotaLog).map((call) => call.dir).sort(), names.map((name) => memberDir(name)).sort());
  for (const call of readLog(quotaLog) as { profiles?: string | null }[]) assert.equal(call.profiles, null);
  assert.match(out, /crewrota {2}crew quota/);
  for (const name of names) assert.match(out, new RegExp(`${name} +▖+ +30% +▖+ +55%`));

  cli(['config', 'refresh', 'off']);
  const reads = readLog(quotaLog).length;
  assert.match(cli(['quota'], { FAKE_QUOTA_LOG: quotaLog, FAKE_QUOTA_FIVE: '90' }).out, /30%/);
  assert.equal(readLog(quotaLog).length, reads);
  cli(['config', 'refresh', 'on']);
  assert.match(cli(['quota', 'extra']).err, /Usage: crew quota/);
});

test('a member whose quota-axi read fails or is not fresh keeps its last reading', () => {
  for (const env of [{ FAKE_QUOTA_STATUS: 'stale', FAKE_QUOTA_FIVE: '90' }, { FAKE_QUOTA_EXIT: '1' }] as Record<string, string>[]) {
    const { code, out } = cli(['quota'], env);
    assert.equal(code, 0);
    assert.match(out, /home +▖+ +30% +▖+ +55%/);
  }
});

test('warmup says what it does, sends each member one Haiku message, then shows the bars', () => {
  const before = probes().length;
  const { code, out } = cli(['warmup'], { FAKE_CLAUDE_FIVE: '7' });
  const names = Object.keys(loadConfig().members);
  assert.equal(code, 0);
  assert.match(out, /Each member gets one short message \(Haiku\), which starts its 5-hour window if none is running\./);
  const sent = probes().slice(before);
  assert.deepEqual(sent.map((call) => call.dir).sort(), names.map((name) => memberDir(name)).sort());
  for (const call of sent) assert.ok(call.args.includes('haiku'));
  for (const name of names) assert.match(out, new RegExp(`${name} +▖* +7% +▖+ +40%`));

  const named = probes().length;
  assert.equal(cli(['warmup', 'home']).code, 0);
  assert.deepEqual(probes().slice(named).map((call) => call.dir), [memberDir('home')]);
  assert.match(cli(['warmup', 'nobody']).err, /Crew member nobody doesn't exist/);
  assert.equal(probes().length, named + 1);
});

test('a wrong ship mcp call prints every form of add, as --help does', () => {
  const { code, err } = cli(['ship', 'mcp', 'frob', 'keys']);
  assert.equal(code, 1);
  for (const form of ['crew ship mcp list <ship>', '--url <url> [--header "Name: value"]', '[--env KEY=value] -- <command> [args]', '--from <.claude.json>', 'crew ship mcp remove <ship> <name>']) {
    assert.ok(err.includes(form), form);
  }
});

test('quota --format menubar reads each member\'s last reading and never checks usage, even with refresh on', () => {
  const probes = () => readLog(log).filter((call) => call.args.includes('-p')).length;
  const before = probes();
  const config = loadConfig();
  assert.notEqual(config.refreshReadings, false);
  const { code, out } = cli(['quota', '--format', 'menubar']);
  assert.equal(code, 0);
  assert.equal(probes(), before);
  const lines = out.trimEnd().split(/\r?\n/);
  const current = config.current ? readQuota(memberDir(config.current))?.fiveHour : null;
  assert.deepEqual(lines.slice(0, 2), [current === null || current === undefined ? 'crew' : `crew ${current}%`, '---']);
  for (const name of Object.keys(config.members)) assert.ok(lines.includes(name === config.current ? `${name} | font=Helvetica-Bold` : name), name);
  assert.equal(lines.at(-1), 'Refresh | refresh=true');
  assert.match(cli(['quota', '--format', 'json']).err, /Usage: crew quota \[--format menubar\]/);
  assert.match(cli(['quota', '--format']).err, /Usage: crew quota/);
});

test('the Lavish rule is on by default; config lavish off and on set it, and config show says so', () => {
  assert.match(cli(['config', 'show']).out, /Lavish rule at session start: on/);
  assert.match(cli(['config', 'show']).out, /Lavish telemetry: not asked yet \(crew setup asks\)/);
  const off = cli(['config', 'lavish', 'off']);
  assert.equal(off.code, 0);
  assert.match(off.out, /without the Lavish rule/);
  assert.equal(loadConfig().lavishRule, false);
  assert.match(cli(['config', 'show']).out, /Lavish rule at session start: off/);
  cli(['config', 'lavish', 'on']);
  assert.equal(loadConfig().lavishRule, undefined);
  assert.match(cli(['config', 'show']).out, /Lavish rule at session start: on/);
  assert.match(cli(['config', 'lavish']).err, /config lavish on\|off/);
});

test('setup without a terminal and without --yes lists the installs, then refuses with the hint', () => {
  const { code, out, err } = cli(['setup']);
  assert.equal(code, 1);
  assert.match(out, /npx skills add kunchenguid\/lavish-axi --skill lavish -g/);
  assert.match(err, /crew setup asks once before it installs anything, and that needs a terminal\. Run it in a terminal, or pass --yes/);
  assert.match(cli(['setup', '--now']).err, /Unknown option: --now/);
});

test('doctor lists each default tool, and a missing one does not fail it', () => {
  const { code, out } = cli(['doctor']);
  assert.equal(code, 0);
  assert.match(out, /miss {2}quota-axi skill: missing\r?\n {6}fix: npx skills add kunchenguid\/quota-axi --skill quota-axi -g \(or: crew setup\)/);
  assert.match(out, /lavish-axi session hook \(opt-in\): missing/);
});

test('an unknown command or option fails with a clear message', () => {
  assert.equal(cli(['launch']).code, 1);
  assert.match(cli(['list', 'extra']).err, /Usage: crew list/);
  assert.match(cli(['remove', 'home', '--now']).err, /Unknown option: --now/);
});
