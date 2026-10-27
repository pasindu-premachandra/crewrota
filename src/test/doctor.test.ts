import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { Runner } from '../claude.js';
import { loadConfig, saveConfig } from '../config.js';
import { type Check, runDoctor } from '../doctor.js';
import { mainClaudeDir, memberDir, shipDir } from '../paths.js';
import { syncSharedItems } from '../shared.js';
import { joinShip } from '../ships.js';
import { fakeMember, isolate } from './helpers.js';

isolate();
delete process.env.CREWROTA_CLAUDE; // the injected runner stands in for claude; nothing real is run

const missing = (): ReturnType<Runner> => {
  const error = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException;
  return { status: null, stdout: '', stderr: '', error };
};

const statusDirs: string[] = [];
const runner: Runner = (command, args, env) => {
  if (command === 'claude' && args[0] === '--version') return { status: 0, stdout: '2.1.310 (Claude Code)\n', stderr: '' };
  if (command === 'claude' && args.join(' ') === 'auth status --json') {
    const dir = env?.CLAUDE_CONFIG_DIR ?? '';
    statusDirs.push(dir);
    const loggedIn = dir === memberDir('work');
    return { status: loggedIn ? 0 : 1, stdout: JSON.stringify({ loggedIn, configDirectory: dir }), stderr: '' };
  }
  return missing();
};

function details(checks: Check[]): string[] {
  return checks.map((check) => `${check.ok ? 'ok' : 'FAIL'} ${check.name}: ${check.detail}`);
}

test('doctor on a fresh machine: everything ok and nothing created', () => {
  const checks = runDoctor({}, runner);
  const byName = Object.fromEntries(checks.map((check) => [check.name, check]));
  assert.ok(checks.every((check) => check.ok), details(checks).join('\n'));
  assert.equal(byName.claude.detail, 'claude 2.1.310 (Claude Code)');
  assert.match(byName.home.detail, /not created yet/);
  assert.match(byName.config.detail, /not created yet/);
  assert.match(byName.members.detail, /crew add <member>/);
  assert.match(byName.permissions.detail, /not asked yet/);
  assert.equal(fs.existsSync(process.env.CREWROTA_HOME!), false);
});

test('doctor reports a missing claude with the install fix for this OS', () => {
  const claude = runDoctor({}, () => missing()).find((check) => check.name === 'claude')!;
  assert.equal(claude.ok, false);
  assert.match(claude.fix!, /claude\.ai\/install/);
  const shell = process.platform === 'win32' ? /PowerShell/ : process.platform === 'darwin' ? /Terminal/ : /shell/;
  assert.match(claude.fix!, shell);
});

test('doctor checks each member folder, ship join and shared link, and logins only with --logins', () => {
  fs.mkdirSync(path.join(mainClaudeDir(), 'skills'), { recursive: true });
  const config = loadConfig();
  fakeMember(config, 'work');
  fakeMember(config, 'drifted');
  fakeMember(config, 'gone');
  joinShip(config, 'work', 'team');
  joinShip(config, 'drifted', 'solo');
  syncSharedItems(memberDir('work'), undefined);
  fs.rmSync(shipDir('solo'), { recursive: true });
  fs.rmSync(memberDir('gone'), { recursive: true });
  config.skipPermissions = true;
  saveConfig(config);

  const checks = runDoctor({}, runner);
  assert.deepEqual(details(checks).slice(4), [
    `ok member: drifted: folder ${memberDir('drifted')}`,
    'FAIL ship join: drifted: the link to ship solo points at a folder that does not exist',
    'ok shared link: drifted: skills is linked at the next launch',
    `FAIL member: gone: folder ${memberDir('gone')} is missing`,
    `ok member: work: folder ${memberDir('work')}`,
    'ok ship join: work: linked to ship team',
    'ok shared link: work: skills linked to your main setup',
    'ok permissions: --dangerously-skip-permissions: on',
  ]);
  assert.match(checks.find((check) => check.name === 'ship join' && !check.ok)!.fix!, /crew run drifted/);
  assert.deepEqual(statusDirs, []);

  const withLogins = runDoctor({ logins: true }, runner);
  assert.deepEqual(statusDirs, [memberDir('drifted'), memberDir('work')]);
  assert.deepEqual(
    details(withLogins.filter((check) => check.name === 'login')),
    ['FAIL login: drifted: not logged in', 'ok login: work: logged in'],
  );
});

test('doctor checks for VS Code only once there is a shortcut', () => {
  const config = loadConfig();
  assert.equal(runDoctor({}, runner).find((check) => check.name === 'vscode'), undefined);
  config.shortcuts = [{ name: 'job', member: 'work', folder: 'E:/code' }];
  saveConfig(config);
  process.env.CREWROTA_CODE = path.join(mainClaudeDir(), 'Code.exe');
  assert.deepEqual(details(runDoctor({}, runner).filter((check) => check.name === 'vscode')), [`ok vscode: VS Code ${process.env.CREWROTA_CODE}`]);
});
