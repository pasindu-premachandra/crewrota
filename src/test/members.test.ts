import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CANCEL_SYMBOL } from '@clack/prompts';
import { loadConfig } from '../config.js';
import { linkState } from '../links.js';
import { type MemberDeps, addMember, realDeps, useMember } from '../members.js';
import { memberDir, shipProjectsDir } from '../paths.js';
import { isolate, readLog, scriptedUi } from './helpers.js';

const root = isolate();
const log = path.join(root, 'fake-claude.log');
process.env.FAKE_CLAUDE_LOG = log;

// The real login and status calls, run against the fake claude, with scripted answers.
function scripted(answers: unknown[]) {
  const { ui, asked } = scriptedUi(answers);
  const lines: string[] = [];
  const deps: MemberDeps = { ...realDeps, ui, log: (line) => lines.push(line) };
  return { deps, asked, lines };
}

function callsSince(start: number) {
  return readLog(log).slice(start);
}

function withEnv(name: string, value: string, body: () => Promise<void>): Promise<void> {
  process.env[name] = value;
  return body().finally(() => delete process.env[name]);
}

test('add: login ok and status ok registers the member, isolated, and makes it current when there is none', async () => {
  const { deps, asked, lines } = scripted(['isolated']);
  const config = loadConfig();
  assert.equal(await addMember(config, 'work', {}, deps), true);

  const dir = memberDir('work');
  assert.deepEqual(readLog(log), [
    { args: [], dir },
    { args: ['auth', 'status', '--json'], dir },
  ]);
  const saved = loadConfig();
  assert.equal(saved.current, 'work');
  assert.equal(saved.members.work.provider, 'claude');
  assert.equal(saved.members.work.ship, undefined);
  assert.match(saved.members.work.created, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(lines.includes('[OK] Signed in as sam@example.com (personal)'));
  assert.ok(lines.includes('[i] Creating crew member: work'));
  assert.ok(lines.includes(`[i] Member folder: ${dir}`));
  assert.ok(lines.includes('[i] Start it with: crew run work'));

  assert.deepEqual(
    asked.map(({ kind, message, initialValue }) => ({ kind, message, initialValue })),
    [
      { kind: 'select', message: 'Share history with other members?', initialValue: 'isolated' },
    ],
  );
  assert.deepEqual(asked[0].options!.map((option) => option.value), ['isolated', 'create']);
});

test('add passes --email and --sso to claude auth login and leaves the current member alone', async () => {
  const start = readLog(log).length;
  const { deps } = scripted(['isolated']);
  const config = loadConfig();
  assert.equal(await addMember(config, 'home', { email: 'kim@example.com', sso: true }, deps), true);
  assert.deepEqual(callsSince(start)[0].args, ['auth', 'login', '--email', 'kim@example.com', '--sso']);
  const saved = loadConfig();
  assert.equal(saved.current, 'work');
});

test('a second member with the same email and organisation gets a warning', async () => {
  const { deps, lines } = scripted(['isolated']);
  assert.equal(await addMember(loadConfig(), 'work-two', {}, deps), true);
  assert.ok(lines.includes('[!] Crew member work is already signed in as sam@example.com (personal).'));
});

test('a different organisation for the same email is not a duplicate', async () => {
  await withEnv('FAKE_CLAUDE_ORG', 'Example Org', async () => {
    const { deps, lines } = scripted(['isolated']);
    assert.equal(await addMember(loadConfig(), 'work-org', {}, deps), true);
    assert.ok(lines.includes('[OK] Signed in as sam@example.com (Example Org)'));
    assert.equal(lines.some((line) => line.startsWith('Warning')), false);
  });
});

test('status failing removes the new folder and registers nothing', async () => {
  await withEnv('FAKE_CLAUDE_STATUS_EXIT', '1', async () => {
    const { deps, asked } = scripted(['isolated']);
    await assert.rejects(addMember(loadConfig(), 'broken', {}, deps), /not logged in \(exit code 1\)\. Removed .*broken; no crew member was created/);
    assert.equal(fs.existsSync(memberDir('broken')), false);
    assert.equal(loadConfig().members.broken, undefined);
    assert.equal(asked.length, 0);
  });
});

test('a status that reports another config folder also removes the new folder', async () => {
  await withEnv('FAKE_CLAUDE_CONFIG_DIRECTORY', path.join(root, 'elsewhere'), async () => {
    const { deps } = scripted([]);
    await assert.rejects(addMember(loadConfig(), 'astray', {}, deps), /reported the config folder .*elsewhere instead of/);
    assert.equal(fs.existsSync(memberDir('astray')), false);
    assert.equal(loadConfig().members.astray, undefined);
  });
});

test('a failed login removes the new folder, judged by claude auth status', async () => {
  await withEnv('FAKE_CLAUDE_LOGIN_EXIT', '3', async () => {
    const start = readLog(log).length;
    const { deps } = scripted([]);
    await assert.rejects(addMember(loadConfig(), 'nologin', {}, deps), /not logged in .*\(claude exited with code 3\)/);
    assert.deepEqual(callsSince(start).map((call) => call.args), [[], ['auth', 'status', '--json']]);
    assert.equal(fs.existsSync(memberDir('nologin')), false);
  });
});

test('Ctrl+C at a later question removes the new folder and registers nothing', async () => {
  for (const answers of [[CANCEL_SYMBOL], ['create', CANCEL_SYMBOL]]) {
    const { deps } = scripted(answers);
    assert.equal(await addMember(loadConfig(), 'quitter', {}, deps), false);
    assert.equal(fs.existsSync(memberDir('quitter')), false);
    assert.equal(loadConfig().members.quitter, undefined);
  }
});

test('names are checked before any prompt or login', async () => {
  const start = readLog(log).length;
  const { deps, asked } = scripted([true]);
  await assert.rejects(addMember(loadConfig(), 'Bad_Name', {}, deps), /not a valid crew member name/);
  await assert.rejects(addMember(loadConfig(), 'fine', { ship: 'Bad Ship' }, deps), /not a valid ship name/);
  assert.equal(asked.length, 0);
  assert.equal(callsSince(start).length, 0);
});

test('add refuses a member that already exists', async () => {
  const { deps } = scripted([]);
  await assert.rejects(addMember(loadConfig(), 'work', {}, deps), /^Error: Crew member work already exists$/);
});

test('use on a missing member asks, and creates it on Yes', async () => {
  const { deps, asked } = scripted([true, 'isolated']);
  const config = loadConfig();
  assert.equal(await useMember(config, 'projects', deps), true);
  assert.deepEqual({ kind: asked[0].kind, message: asked[0].message, initialValue: asked[0].initialValue }, {
    kind: 'confirm',
    message: "Crew member projects doesn't exist. Create it? (Y/n)",
    initialValue: true,
  });
  const saved = loadConfig();
  assert.ok(saved.members.projects);
  assert.equal(saved.current, 'projects');
  assert.equal(saved.previous, 'work');
});

test('No or Ctrl+C at the create question creates nothing and runs no login', async () => {
  for (const answer of [false, CANCEL_SYMBOL]) {
    const start = readLog(log).length;
    const { deps } = scripted([answer]);
    assert.equal(await useMember(loadConfig(), 'nobody', deps), false);
    assert.equal(fs.existsSync(memberDir('nobody')), false);
    assert.equal(loadConfig().members.nobody, undefined);
    assert.equal(callsSince(start).length, 0);
  }
});

test('use switches only, and use - goes back to the previous member', async () => {
  const start = readLog(log).length;
  const { deps } = scripted([]);
  await useMember(loadConfig(), 'home', deps);
  assert.deepEqual([loadConfig().current, loadConfig().previous], ['home', 'projects']);
  await useMember(loadConfig(), '-', deps);
  assert.deepEqual([loadConfig().current, loadConfig().previous], ['projects', 'home']);
  await useMember(loadConfig(), '-', deps);
  assert.equal(loadConfig().current, 'home');
  assert.equal(callsSince(start).length, 0);
});

test('use - with no previous member fails', async () => {
  const config = loadConfig();
  delete config.previous;
  await assert.rejects(useMember(config, '-', scripted([]).deps), /no previous crew member/);
});

test('add --ship with a missing ship asks first, then links the new member', async () => {
  const { deps, asked } = scripted([true]);
  const config = loadConfig();
  assert.equal(await addMember(config, 'teamer', { ship: 'team' }, deps), true);
  assert.equal(asked[0].message, "Ship team doesn't exist. Create it? (Y/n)");
  assert.equal(asked.length, 1);
  assert.equal(loadConfig().members.teamer.ship, 'team');
  assert.equal(linkState(path.join(memberDir('teamer'), 'projects'), shipProjectsDir('team')), 'ok');
});

test('No to creating the --ship ship creates nothing and runs no login', async () => {
  const start = readLog(log).length;
  const { deps } = scripted([false]);
  assert.equal(await addMember(loadConfig(), 'loner', { ship: 'nowhere' }, deps), false);
  assert.equal(fs.existsSync(memberDir('loner')), false);
  assert.equal(fs.existsSync(shipProjectsDir('nowhere')), false);
  assert.equal(callsSince(start).length, 0);
});

test('the share question can create a ship, or join an existing one', async () => {
  const first = scripted(['create', 'crew']);
  assert.equal(await addMember(loadConfig(), 'one', {}, first.deps), true);
  assert.equal(linkState(path.join(memberDir('one'), 'projects'), shipProjectsDir('crew')), 'ok');

  const second = scripted(['link', 'crew']);
  assert.equal(await addMember(loadConfig(), 'two', {}, second.deps), true);
  assert.deepEqual(second.asked[0].options!.map((option) => option.value), ['isolated', 'link', 'create']);
  assert.deepEqual(second.asked[1].options!.map((option) => option.value), ['crew', 'team']);
  assert.equal(loadConfig().members.two.ship, 'crew');
  assert.equal(linkState(path.join(memberDir('two'), 'projects'), shipProjectsDir('crew')), 'ok');
});
