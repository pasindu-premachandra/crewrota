import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { backup, projectSlug, remapName, tarPath, zipEntryCount } from '../backup.js';
import { loadConfig, saveConfig } from '../config.js';
import { mapFolder } from '../context.js';
import { linkState } from '../links.js';
import { memberDir, shipDir } from '../paths.js';
import { createShip, joinShip, shipFolder, writeShipMcp } from '../ships.js';
import { cliPath, fakeMember, isolate } from './helpers.js';

const root = fs.realpathSync.native(isolate());
delete process.env.CREWROTA_BACKUP_PASSWORD;

let noTar: string | false = false;
try {
  tarPath();
} catch {
  noTar = 'no bsdtar found (on Linux, install libarchive-tools)';
}

type Home = Record<string, string>;

function makeHome(name: string): Home {
  const dir = path.join(root, name);
  const home = {
    HOME: path.join(dir, 'home'),
    USERPROFILE: path.join(dir, 'home'),
    APPDATA: path.join(dir, 'appdata'),
    XDG_CONFIG_HOME: path.join(dir, 'xdg-config'),
    CREWROTA_HOME: path.join(dir, 'crew-home'),
  };
  for (const folder of Object.values(home)) fs.mkdirSync(folder, { recursive: true });
  return home;
}

function useHome(home: Home): void {
  Object.assign(process.env, home);
}

function cli(args: string[], home: Home, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', env: { ...process.env, ...home, ...env } });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

// Two members, one on ship team with a session file under the home folder's project slug and one MCP server.
function seedHome(name: string, servers: Record<string, unknown> = { tool: { type: 'http', url: 'https://example.com/mcp' } }): Home {
  const home = makeHome(name);
  useHome(home);
  const config = loadConfig();
  fakeMember(config, 'work');
  fakeMember(config, 'home');
  config.members.work.model = 'opus';
  config.members.work.effort = 'high';
  config.lastModel = 'sonnet';
  config.current = 'work';
  createShip('team');
  joinShip(config, 'work', 'team');
  saveConfig(config);
  writeShipMcp('team', servers);
  const project = path.join(shipFolder('team', 'projects'), `${projectSlug(home.HOME)}-proj`);
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 's1.jsonl'), '{"from":"a"}\n');
  return home;
}

function backupTo(home: Home, folder: string, env: Record<string, string> = {}, args: string[] = []) {
  const to = path.join(root, folder);
  const result = cli(['backup', '--to', to, ...args], home, env);
  const zip = fs.existsSync(to) ? fs.readdirSync(to).find((name) => name.endsWith('.zip')) : undefined;
  return { ...result, zip: zip ? path.join(to, zip) : '' };
}

// Reads the zip's central directory: each entry's name and compression method (99 is AES).
function zipEntries(file: string): { name: string; method: number }[] {
  const zip = fs.readFileSync(file);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = zip.readUInt32LE(end + 16);
  const entries = [];
  for (let n = zip.readUInt16LE(end + 10); n > 0; n--) {
    const nameLength = zip.readUInt16LE(at + 28);
    entries.push({ name: zip.toString('utf8', at + 46, at + 46 + nameLength), method: zip.readUInt16LE(at + 10) });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return entries;
}

test('projectSlug makes every character but an ASCII letter or digit a hyphen', () => {
  assert.equal(projectSlug('E:\\Projects'), 'E--Projects');
  assert.equal(projectSlug('C:\\Users\\Sam Example'), 'C--Users-Sam-Example');
  assert.equal(projectSlug('C:\\Users\\SAMEXA~1'), 'C--Users-SAMEXA-1');
  assert.equal(projectSlug('/home/sam/code'), '-home-sam-code');
});

test('remapName matches a prefix only at a hyphen, longest prefix first', () => {
  const remaps: [string, string][] = [['E--Projects', 'D--work'], ['E--Projects-app', 'F--app']];
  assert.deepEqual(remapName('E--Projects', remaps), ['E--Projects', 'D--work']);
  assert.deepEqual(remapName('E--Projects-site', remaps), ['E--Projects', 'D--work-site']);
  assert.deepEqual(remapName('E--Projects-app-api', remaps), ['E--Projects-app', 'F--app-api']);
  assert.equal(remapName('E--Projects2-site', remaps), null);
});

test('backup writes one zip with manifest.json, config.json and the ships, nothing from members/', { skip: noTar }, async () => {
  const a = seedHome('plain-a');
  const { code, out, err, zip } = backupTo(a, 'out-plain');
  assert.equal(code, 0, err);
  assert.match(path.basename(zip), /^crewrota-backup-\d{8}-\d{4}\.zip$/);
  const names = zipEntries(zip).map((entry) => entry.name);
  assert.ok(names.includes('manifest.json'));
  assert.ok(names.includes('config.json'));
  assert.ok(names.includes('ships/team/mcp.json'));
  assert.ok(names.includes(`ships/team/projects/${projectSlug(a.HOME)}-proj/s1.jsonl`));
  assert.ok(names.every((name) => !name.startsWith('members/') && !name.includes('.credentials')), names.join('\n'));
  assert.match(out, /Backup written: .*crewrota-backup-/);
  assert.match(out, /1 ship, 2 members/);
  assert.match(out, /crew login <member>/);

  const options = { to: path.join(root, 'out-twice'), version: '0.0.0', now: new Date(2026, 9, 26, 9, 5) };
  const made = await backup(loadConfig(), options, () => {});
  assert.equal(path.basename(made), 'crewrota-backup-20261026-0905.zip');
  await assert.rejects(() => backup(loadConfig(), options, () => {}), /already exists/);
  assert.equal(zipEntryCount(made), zipEntries(made).length);
  const manifest = JSON.parse(spawnSync(tarPath(), ['-x', '-O', '-f', zip, 'manifest.json'], { encoding: 'utf8' }).stdout);
  assert.equal(manifest.format, 2);
  assert.equal(manifest.home, a.HOME);
  assert.deepEqual(manifest.ships, ['team']);
  assert.deepEqual(manifest.members, { work: { ship: 'team', model: 'opus', effort: 'high' }, home: {} });
});

test('with a password the entries are AES encrypted and restore needs the password', { skip: noTar }, () => {
  const a = seedHome('secret-a');
  const password = { CREWROTA_BACKUP_PASSWORD: 'correct horse' };
  const { code, out, err, zip } = backupTo(a, 'out-secret', password, ['--password']);
  assert.equal(code, 0, err);
  assert.doesNotMatch(out, /correct horse/);
  assert.doesNotMatch(out, /plain text/);
  const files = zipEntries(zip).filter((entry) => !entry.name.endsWith('/'));
  assert.ok(files.length > 0);
  assert.ok(files.every((entry) => entry.method === 99), JSON.stringify(files));

  const b = makeHome('secret-b');
  assert.match(cli(['restore', zip], b).err, /is encrypted\. Add --password\./);
  assert.match(cli(['restore', zip, '--password'], b, { CREWROTA_BACKUP_PASSWORD: 'wrong' }).err, /The password does not open/);
  const restored = cli(['restore', zip, '--password'], b, password);
  assert.equal(restored.code, 0, restored.err);
  assert.match(restored.out, /crew login work/);
  assert.deepEqual(fs.readdirSync(b.CREWROTA_HOME).filter((name) => name.startsWith('restore-')), []);
});

test('restore into a fresh home re-creates the members, ships and mcp.json, and asks for each login', { skip: noTar }, () => {
  const a = seedHome('fresh-a');
  const { zip } = backupTo(a, 'out-fresh');
  const b = makeHome('fresh-b');
  const { code, out, err } = cli(['restore', zip], b);
  assert.equal(code, 0, err);
  useHome(b);
  const config = loadConfig();
  assert.deepEqual(Object.keys(config.members).sort(), ['home', 'work']);
  assert.equal(config.members.work.ship, 'team');
  assert.equal(config.members.work.model, 'opus');
  assert.equal(config.members.work.effort, 'high');
  assert.equal(config.members.home.ship, undefined);
  assert.equal(config.lastModel, 'sonnet');
  assert.equal(config.current, 'work');
  for (const name of ['work', 'home']) {
    assert.ok(fs.statSync(memberDir(name)).isDirectory());
    assert.equal(fs.existsSync(path.join(memberDir(name), '.credentials.json')), false);
    assert.equal(fs.existsSync(path.join(memberDir(name), '.claude.json')), false);
  }
  assert.equal(linkState(path.join(memberDir('work'), 'projects'), shipFolder('team', 'projects')), 'ok');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(shipDir('team'), 'mcp.json'), 'utf8')).mcpServers, { tool: { type: 'http', url: 'https://example.com/mcp' } });
  assert.ok(fs.existsSync(path.join(shipFolder('team', 'projects'), `${projectSlug(b.HOME)}-proj`, 's1.jsonl')));
  assert.match(out, /crew login work/);
  assert.match(out, /crew login home/);
  assert.deepEqual(fs.readdirSync(b.CREWROTA_HOME).filter((name) => name.startsWith('restore-')), []);
});

test('the home folder and --map rename project folders by the slug rule, never past a prefix boundary', { skip: noTar }, () => {
  const a = seedHome('map-a');
  const projects = shipFolder('team', 'projects');
  for (const name of [projectSlug(a.HOME), 'E--Projects', 'E--Projects-app', 'E--Projects2-app']) {
    fs.mkdirSync(path.join(projects, name), { recursive: true });
    fs.writeFileSync(path.join(projects, name, `${name}.jsonl`), '{}\n');
  }
  const { zip } = backupTo(a, 'out-map');
  const b = makeHome('map-b');
  const { code, out, err } = cli(['restore', zip, '--map', 'E:\\Projects=D:\\work'], b);
  assert.equal(code, 0, err);
  useHome(b);
  const slugB = projectSlug(b.HOME);
  assert.deepEqual(fs.readdirSync(shipFolder('team', 'projects')).sort(), [slugB, `${slugB}-proj`, 'D--work', 'D--work-app', 'E--Projects2-app'].sort());
  assert.ok(fs.existsSync(path.join(shipFolder('team', 'projects'), 'D--work-app', 'E--Projects-app.jsonl')));
  assert.match(out, /Project folders E--Projects renamed to D--work: 2/);
  assert.match(out, new RegExp(`renamed to ${slugB}: 2`));
});

test('restore into a home that has the ship merges: an existing session kept, a new one added', { skip: noTar }, () => {
  const a = seedHome('merge-a', { tool: { type: 'http', url: 'https://example.com/mcp' }, extra: { type: 'stdio', command: 'extra' } });
  const { zip } = backupTo(a, 'out-merge');
  const b = seedHome('merge-b', { tool: { type: 'http', url: 'https://example.org/mine' } });
  const project = path.join(shipFolder('team', 'projects'), `${projectSlug(b.HOME)}-proj`);
  fs.writeFileSync(path.join(project, 's1.jsonl'), '{"from":"b"}\n');
  fs.writeFileSync(path.join(project, 'old.jsonl'), '{"old":true}\n');

  const { code, out, err } = cli(['restore', zip], b);
  assert.equal(code, 0, err);
  useHome(b);
  assert.equal(fs.readFileSync(path.join(project, 'old.jsonl'), 'utf8'), '{"old":true}\n');
  assert.equal(fs.readFileSync(path.join(project, 's1.jsonl'), 'utf8'), '{"from":"b"}\n');
  assert.equal(fs.readFileSync(path.join(project, 's1.incoming-1.jsonl'), 'utf8'), '{"from":"a"}\n');
  const servers = JSON.parse(fs.readFileSync(path.join(shipDir('team'), 'mcp.json'), 'utf8')).mcpServers;
  assert.deepEqual(servers, { tool: { type: 'http', url: 'https://example.org/mine' }, extra: { type: 'stdio', command: 'extra' } });
  assert.match(out, /Added to ship team's MCP servers: extra/);
  assert.match(out, /Already here, left alone: work, home/);
  assert.doesNotMatch(out, /crew login/);
});

test('without a password the backup warns when a ship has MCP servers, and not with one', { skip: noTar }, () => {
  const a = seedHome('warn-a');
  assert.match(backupTo(a, 'out-warn').out, /MCP servers of team with their keys in plain text\. Add --password to encrypt it\./);
  assert.doesNotMatch(backupTo(a, 'out-warn-pw', { CREWROTA_BACKUP_PASSWORD: 'pw' }, ['--password']).out, /plain text/);
  const quiet = seedHome('warn-none', {});
  assert.doesNotMatch(backupTo(quiet, 'out-warn-none').out, /plain text/);
});

test('--password without a terminal or CREWROTA_BACKUP_PASSWORD refuses', () => {
  const a = makeHome('nopass');
  const made = cli(['backup', '--password', '--to', path.join(root, 'out-nopass')], a);
  assert.equal(made.code, 1);
  assert.match(made.err, /--password needs a terminal, or the password in CREWROTA_BACKUP_PASSWORD\./);
  assert.equal(fs.existsSync(path.join(root, 'out-nopass')), false);
  assert.match(cli(['restore', 'any.zip', '--password'], a).err, /--password needs a terminal/);
});

test('backup and restore refuse unknown options and a bad --map', () => {
  const a = makeHome('flags');
  assert.match(cli(['backup', '--force'], a).err, /Unknown option: --force/);
  assert.match(cli(['restore', 'x.zip', '--yes'], a).err, /Unknown option: --yes/);
  assert.match(cli(['restore', 'x.zip', '--map', 'nothing'], a).err, /--map takes <old folder>=<new folder>/);
  assert.match(cli(['restore'], a).err, /Usage: crew restore <zip>/);
  const help = cli(['--help'], a).out;
  assert.ok(help.includes('crew backup [--to <folder>] [--password] [--skip <folder>]... [--no-context] [--dry-run]'));
  assert.ok(help.includes('crew restore <zip> [--map <old>=<new>]... [--password] [--clone]'));
});

// A project with a .claude holding a task, a login that must stay behind, a session that names it, and main setup skills.
function seedContext(name: string): { home: Home; project: string } {
  const home = seedHome(name);
  const project = path.join(root, `${name}-code`, 'app');
  const claude = path.join(project, '.claude');
  fs.mkdirSync(path.join(claude, 'tasks', 'export', 'evidence'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'memories'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'skills', 'local'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(claude, 'tasks', 'export', 'README.md'), 'task notes\n');
  fs.writeFileSync(path.join(claude, 'tasks', 'export', 'evidence', 'run.txt'), 'evidence\n');
  fs.writeFileSync(path.join(claude, 'memories', 'fact.md'), 'fact\n');
  fs.writeFileSync(path.join(claude, 'skills', 'local', 'SKILL.md'), 'local skill\n');
  fs.writeFileSync(path.join(claude, 'node_modules', 'dep', 'index.js'), 'x\n');
  fs.writeFileSync(path.join(claude, 'settings.local.json'), '{}\n');
  fs.writeFileSync(path.join(claude, '.env'), 'KEY=1\n');
  fs.writeFileSync(path.join(claude, '.credentials.json'), '{}\n');
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), 'project rules\n');
  const session = path.join(shipFolder('team', 'projects'), 'app');
  fs.mkdirSync(session, { recursive: true });
  fs.writeFileSync(path.join(session, 's.jsonl'), `${JSON.stringify({ type: 'user', cwd: project })}\n`);

  const main = path.join(home.HOME, '.claude');
  const elsewhere = path.join(home.HOME, '.agents', 'skills', 'linked');
  fs.mkdirSync(elsewhere, { recursive: true });
  fs.writeFileSync(path.join(elsewhere, 'SKILL.md'), 'linked skill\n');
  fs.mkdirSync(path.join(main, 'skills', 'email-writing', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(main, 'skills', 'synced', 'bucket'), { recursive: true });
  fs.mkdirSync(path.join(main, 'skills', '.trash', 'old'), { recursive: true });
  fs.mkdirSync(path.join(main, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(main, 'skills', 'email-writing', 'SKILL.md'), 'email skill\n');
  fs.writeFileSync(path.join(main, 'skills', 'email-writing', 'scripts', 'copy.ps1'), 'copy\n');
  fs.writeFileSync(path.join(main, 'skills', 'synced', 'bucket', 'x.txt'), 'x\n');
  fs.writeFileSync(path.join(main, 'skills', '.trash', 'old', 'SKILL.md'), 'old\n');
  fs.writeFileSync(path.join(main, 'agents', 'helper.md'), 'agent\n');
  fs.writeFileSync(path.join(main, 'CLAUDE.md'), 'global rules\n');
  fs.symlinkSync(elsewhere, path.join(main, 'skills', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  return { home, project };
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function isLink(file: string): boolean {
  return fs.lstatSync(file).isSymbolicLink();
}

test('backup carries every project .claude, the skills with links resolved, and no login or machine-local file', { skip: noTar }, () => {
  const { home, project } = seedContext('ctx-zip');
  const { code, err, zip, out } = backupTo(home, 'out-ctx-zip');
  assert.equal(code, 0, err);
  assert.match(out, /1 project \.claude folders and 2 skills/);
  const names = zipEntries(zip).map((entry) => entry.name);
  for (const name of [
    'context/roots/r1/.claude/tasks/export/README.md',
    'context/roots/r1/.claude/tasks/export/evidence/run.txt',
    'context/roots/r1/.claude/memories/fact.md',
    'context/roots/r1/.claude/skills/local/SKILL.md',
    'context/roots/r1/CLAUDE.md',
    'context/main/skills/email-writing/SKILL.md',
    'context/main/skills/email-writing/scripts/copy.ps1',
    'context/main/skills/linked/SKILL.md',
    'context/main/agents/helper.md',
    'context/main/files/CLAUDE.md',
  ]) {
    assert.ok(names.includes(name), `${name} missing from\n${names.join('\n')}`);
  }
  for (const part of ['node_modules', 'settings.local.json', '/.env', '.credentials', 'skills/synced', 'skills/.trash']) {
    assert.ok(names.every((name) => !name.includes(part)), `${part} is in the zip`);
  }
  assert.equal(names[0], 'manifest.json');
  const manifest = JSON.parse(spawnSync(tarPath(), ['-x', '-O', '-f', zip, 'manifest.json'], { encoding: 'utf8' }).stdout);
  assert.equal(manifest.format, 2);
  assert.deepEqual(manifest.context.roots, [{ id: 'r1', path: project }]);
  assert.deepEqual(manifest.context.skills, ['email-writing', 'linked']);
  assert.deepEqual(fs.readdirSync(path.join(root, 'out-ctx-zip')).filter((name) => name.startsWith('.crew-stage-')), []);
});

test('restore on a new machine puts .claude back through --map and adds to the main setup without overwriting', { skip: noTar }, () => {
  const { home, project } = seedContext('ctx-new');
  const { zip } = backupTo(home, 'out-ctx-new');
  const b = makeHome('ctx-new-b');
  const mine = path.join(b.HOME, '.claude', 'skills', 'email-writing');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'SKILL.md'), 'my newer skill\n');
  const target = path.join(root, 'ctx-new-b-code');
  const { code, err, out } = cli(['restore', zip, '--map', `${path.dirname(project)}=${target}`], b);
  assert.equal(code, 0, err);
  const claude = path.join(target, 'app', '.claude');
  assert.equal(fs.readFileSync(path.join(claude, 'tasks', 'export', 'README.md'), 'utf8'), 'task notes\n');
  assert.equal(fs.readFileSync(path.join(claude, 'tasks', 'export', 'evidence', 'run.txt'), 'utf8'), 'evidence\n');
  assert.equal(fs.readFileSync(path.join(target, 'app', 'CLAUDE.md'), 'utf8'), 'project rules\n');
  assert.equal(fs.readFileSync(path.join(mine, 'SKILL.md'), 'utf8'), 'my newer skill\n');
  assert.equal(fs.readFileSync(path.join(mine, 'SKILL.incoming-1.md'), 'utf8'), 'email skill\n');
  assert.equal(fs.readFileSync(path.join(b.HOME, '.claude', 'skills', 'linked', 'SKILL.md'), 'utf8'), 'linked skill\n');
  assert.equal(isLink(path.join(b.HOME, '.claude', 'skills', 'linked')), false);
  assert.equal(fs.readFileSync(path.join(b.HOME, '.claude', 'CLAUDE.md'), 'utf8'), 'global rules\n');
  assert.match(out, /Project \.claude folders \(1\)/);
  assert.equal(cli(['restore', zip, '--map', `${path.dirname(project)}=${target}`], b).code, 0);
  assert.equal(fs.existsSync(path.join(mine, 'SKILL.incoming-2.md')), false);
});

test('a folder with no place on this machine waits for --map and nothing is written for it', { skip: noTar }, () => {
  const { home } = seedContext('ctx-held');
  const { zip } = backupTo(home, 'out-ctx-held');
  const extract = path.join(root, 'ctx-held-edit');
  fs.mkdirSync(extract);
  assert.equal(spawnSync(tarPath(), ['-x', '-f', zip, '-C', extract]).status, 0);
  const file = path.join(extract, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.context.roots[0].path = 'Q:\\gone\\app';
  manifest.platform = 'win32';
  fs.writeFileSync(file, JSON.stringify(manifest));
  const edited = path.join(root, 'ctx-held.zip');
  assert.equal(spawnSync(tarPath(), ['-a', '-c', '-f', edited, '-C', extract, 'manifest.json', 'config.json', 'context']).status, 0);
  const { code, err, out } = cli(['restore', edited], makeHome('ctx-held-b'));
  assert.equal(code, 0, err);
  assert.match(out, /1 folders have no place on this machine/);
  assert.match(out, /Q:.gone.app/);
});

test('--clone brings the code back and the restored .claude lands in the checkout; unpushed commits are named', { skip: noTar }, () => {
  const { home, project } = seedContext('ctx-clone');
  const bare = path.join(root, 'ctx-clone-remote.git');
  git(root, 'init', '--bare', bare);
  git(project, 'init');
  git(project, 'remote', 'add', 'origin', bare);
  fs.writeFileSync(path.join(project, 'app.js'), 'code\n');
  git(project, 'add', 'app.js');
  git(project, 'commit', '-m', 'first');
  git(project, 'push', '-u', 'origin', 'HEAD');
  fs.writeFileSync(path.join(project, 'app.js'), 'changed\n');
  git(project, 'add', 'app.js');
  git(project, 'commit', '-m', 'not pushed');
  const { zip, out } = backupTo(home, 'out-ctx-clone');
  assert.match(out, /1 unpushed commits/);
  assert.match(out, /Only pushed code comes back/);

  const b = makeHome('ctx-clone-b');
  const target = path.join(root, 'ctx-clone-b-code');
  const map = ['--map', `${path.dirname(project)}=${target}`];
  const first = cli(['restore', zip, ...map], b);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /Code not here yet/);
  assert.equal(fs.existsSync(path.join(target, 'app', 'app.js')), false);
  const second = cli(['restore', zip, ...map, '--clone'], b);
  assert.equal(second.code, 0, second.err);
  assert.equal(fs.readFileSync(path.join(target, 'app', 'app.js'), 'utf8').replace(/\r/g, ''), 'code\n');
  assert.equal(fs.readFileSync(path.join(target, 'app', '.claude', 'tasks', 'export', 'README.md'), 'utf8'), 'task notes\n');
  assert.equal(fs.existsSync(`${path.join(target, 'app')}.crew-restore`), false);
});

test('a linked worktree is not a root, --skip leaves a folder out, --no-context and --dry-run hold', { skip: noTar }, () => {
  const { home, project } = seedContext('ctx-flags');
  git(project, 'init');
  fs.writeFileSync(path.join(project, 'app.js'), 'code\n');
  git(project, 'add', 'app.js');
  git(project, 'commit', '-m', 'first');
  const tree = path.join(root, 'ctx-flags-tree');
  git(project, 'worktree', 'add', '-q', tree);
  fs.mkdirSync(path.join(tree, '.claude'));
  const session = path.join(shipFolder('team', 'projects'), 'tree');
  fs.mkdirSync(session, { recursive: true });
  fs.writeFileSync(path.join(session, 's.jsonl'), `${JSON.stringify({ cwd: tree })}\n`);

  const plain = backupTo(home, 'out-ctx-flags');
  assert.equal(plain.code, 0, plain.err);
  assert.match(plain.out, /1 project \.claude folders/);
  const skipped = backupTo(home, 'out-ctx-skip', {}, ['--skip', project]);
  assert.ok(zipEntries(skipped.zip).every((entry) => !entry.name.startsWith('context/roots/')));
  const none = backupTo(home, 'out-ctx-none', {}, ['--no-context']);
  assert.ok(zipEntries(none.zip).every((entry) => !entry.name.startsWith('context/')));
  assert.doesNotMatch(none.out, /project \.claude folders/);
  const dry = cli(['backup', '--dry-run', '--to', path.join(root, 'out-ctx-dry')], home);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /Dry run: nothing written/);
  assert.equal(fs.existsSync(path.join(root, 'out-ctx-dry')), false);
});

test('a file that looks like it holds a key is named without its value, and not when the backup is encrypted', { skip: noTar }, () => {
  const { home, project } = seedContext('ctx-secret');
  const value = `AKIA${'A1B2'.repeat(4)}`;
  fs.writeFileSync(path.join(project, '.claude', 'tasks', 'export', 'leak.txt'), `key=${value}\n`);
  const { out } = backupTo(home, 'out-ctx-secret');
  assert.match(out, /1 files look like they hold a key \(AWS key\)/);
  assert.match(out, /leak\.txt/);
  assert.ok(!out.includes(value));
  assert.doesNotMatch(backupTo(home, 'out-ctx-secret-pw', { CREWROTA_BACKUP_PASSWORD: 'pw' }, ['--password']).out, /hold a key/);
});

test('names outside the ANSI code page survive, with and without a password', { skip: noTar }, () => {
  const { home, project } = seedContext('ctx-names');
  const name = 'සිංහල-தமிழ்-日本語.md';
  fs.writeFileSync(path.join(project, '.claude', 'tasks', 'export', name), 'notes\n');
  fs.mkdirSync(path.join(project, '.claude', 'tasks', 'தமிழ்'));
  fs.writeFileSync(path.join(project, '.claude', 'tasks', 'தமிழ்', name), 'notes\n');
  for (const [folder, env, args] of [['out-names', {}, []], ['out-names-pw', { CREWROTA_BACKUP_PASSWORD: 'pw' }, ['--password']]] as [string, Record<string, string>, string[]][]) {
    const { zip, code, err } = backupTo(home, folder, env, args);
    assert.equal(code, 0, err);
    assert.ok(zipEntries(zip).every((entry) => /^[ -~]*$/.test(entry.name)));
    const b = makeHome(`${folder}-b`);
    const target = path.join(root, `${folder}-code`);
    const restored = cli(['restore', zip, '--map', `${path.dirname(project)}=${target}`, ...args], b, env);
    assert.equal(restored.code, 0, restored.err);
    assert.ok(fs.readdirSync(path.join(target, 'app', '.claude', 'tasks', 'export')).includes(name));
    assert.equal(fs.readFileSync(path.join(target, 'app', '.claude', 'tasks', 'தமிழ்', name), 'utf8'), 'notes\n');
  }
});

test('--skip leaves out a folder inside a .claude', { skip: noTar }, () => {
  const { home, project } = seedContext('ctx-sub');
  const big = path.join(project, '.claude', 'tasks', 'export', 'evidence');
  const { zip, out } = backupTo(home, 'out-ctx-sub', {}, ['--skip', big]);
  const names = zipEntries(zip).map((entry) => entry.name);
  assert.ok(names.includes('context/roots/r1/.claude/tasks/export/README.md'));
  assert.ok(names.every((name) => !name.includes('evidence')));
  assert.match(out, /login or key files stayed behind/);
});

test('a file that cannot be read is named and does not stop the backup', { skip: noTar || process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const { home, project } = seedContext('ctx-locked');
  const locked = path.join(project, '.claude', 'tasks', 'export', 'locked.txt');
  fs.writeFileSync(locked, 'x\n');
  fs.chmodSync(locked, 0o000);
  const { code, err, out } = backupTo(home, 'out-ctx-locked');
  fs.chmodSync(locked, 0o600);
  assert.equal(code, 0, err);
  assert.match(out, /Could not read 1, left out: .*locked\.txt/);
});

test('--to inside a .claude finishes and the zip does not carry itself', { skip: noTar }, () => {
  const { home, project } = seedContext('ctx-inside');
  const to = path.join(project, '.claude', 'backups');
  const first = cli(['backup', '--to', to], home);
  assert.equal(first.code, 0, first.err);
  const [zip] = fs.readdirSync(to).filter((name) => name.endsWith('.zip'));
  assert.ok(zipEntries(path.join(to, zip)).every((entry) => !entry.name.includes('.crew-stage-') && !entry.name.includes('/backups/crewrota-backup-')));
  assert.deepEqual(fs.readdirSync(to).filter((name) => name.startsWith('.crew-stage-')), []);
});

test('a second restore never undoes an edit on the new machine, even when the edit only shortened a note', { skip: noTar }, () => {
  const { home, project } = seedContext('ctx-edit');
  const { zip } = backupTo(home, 'out-ctx-edit');
  const b = makeHome('ctx-edit-b');
  const target = path.join(root, 'ctx-edit-b-code');
  const map = ['--map', `${path.dirname(project)}=${target}`];
  assert.equal(cli(['restore', zip, ...map], b).code, 0);
  const note = path.join(target, 'app', '.claude', 'tasks', 'export', 'README.md');
  fs.writeFileSync(note, 'task');
  assert.equal(cli(['restore', zip, ...map], b).code, 0);
  assert.equal(fs.readFileSync(note, 'utf8'), 'task');
  assert.equal(fs.readFileSync(note.replace('README.md', 'README.incoming-1.md'), 'utf8'), 'task notes\n');
});

test('a --clone after a plain restore works with a nested .claude, keeps a local edit on top, and finds a repo with no session', { skip: noTar }, () => {
  const { home, project } = seedContext('ctx-nest');
  const bare = path.join(root, 'ctx-nest-remote.git');
  git(root, 'init', '--bare', bare);
  git(project, 'init');
  git(project, 'remote', 'add', 'origin', bare);
  fs.mkdirSync(path.join(project, 'pkg', '.claude', 'memories'), { recursive: true });
  fs.writeFileSync(path.join(project, 'pkg', '.claude', 'memories', 'deep.md'), 'deep\n');
  fs.writeFileSync(path.join(project, '.claude', 'memories', 'tracked.md'), 'old\n');
  git(project, 'add', '.claude/memories/tracked.md');
  git(project, 'commit', '-m', 'first');
  git(project, 'push', '-u', 'origin', 'HEAD');
  fs.writeFileSync(path.join(project, '.claude', 'memories', 'tracked.md'), 'latest edit\n');
  const sibling = path.join(path.dirname(project), 'sibling');
  fs.mkdirSync(path.join(sibling, '.claude'), { recursive: true });
  git(sibling, 'init');
  git(sibling, 'remote', 'add', 'origin', bare);
  fs.mkdirSync(path.join(path.dirname(project), '.claude'));
  const { zip, out } = backupTo(home, 'out-ctx-nest');
  assert.doesNotMatch(out, /app: \d+ changed/);

  const b = makeHome('ctx-nest-b');
  const target = path.join(root, 'ctx-nest-b-code');
  const map = ['--map', `${path.dirname(project)}=${target}`];
  assert.match(cli(['restore', zip, ...map], b).out, /sibling/);
  const second = cli(['restore', zip, ...map, '--clone'], b);
  assert.equal(second.code, 0, second.err);
  assert.ok(fs.existsSync(path.join(target, 'app', '.git')));
  assert.ok(fs.existsSync(path.join(target, 'sibling', '.git')));
  assert.equal(fs.readFileSync(path.join(target, 'app', 'pkg', '.claude', 'memories', 'deep.md'), 'utf8'), 'deep\n');
  assert.equal(fs.readFileSync(path.join(target, 'app', '.claude', 'memories', 'tracked.md'), 'utf8'), 'latest edit\n');
  assert.match(git(path.join(target, 'app'), 'status', '--porcelain', '--', '.claude/memories/tracked.md'), /^ ?M/);
});

test('a .claude below a session folder that has none is found', { skip: noTar }, () => {
  const { home } = seedContext('ctx-below');
  const folder = path.join(root, 'ctx-below-plain');
  fs.mkdirSync(path.join(folder, 'pkg', '.claude'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'pkg', '.claude', 'note.md'), 'n\n');
  const session = path.join(shipFolder('team', 'projects'), 'plain');
  fs.mkdirSync(session, { recursive: true });
  fs.writeFileSync(path.join(session, 's.jsonl'), `${JSON.stringify({ cwd: folder })}\n`);
  assert.match(backupTo(home, 'out-ctx-below-plain').out, /1 project \.claude folders/);
  git(folder, 'init');
  assert.match(backupTo(home, 'out-ctx-below').out, /2 project \.claude folders/);
});

test('a password in a remote URL stays out of the zip, an ssh user name stays in, and a drive map with a backslash renames session folders', { skip: noTar }, () => {
  const { home, project } = seedContext('ctx-login');
  git(project, 'init');
  git(project, 'remote', 'add', 'origin', 'ssh://bob:hunter2@127.0.0.1:9/y.git');
  const { zip, out } = backupTo(home, 'out-ctx-login');
  assert.ok(!out.includes('hunter2'));
  const manifest = spawnSync(tarPath(), ['-x', '-O', '-f', zip, 'manifest.json'], { encoding: 'utf8' }).stdout;
  assert.ok(!manifest.includes('hunter2'));
  assert.ok(manifest.includes('ssh://bob@127.0.0.1:9/y.git'));
  assert.deepEqual(remapName('E--Projects-app', [[projectSlug('E:'), projectSlug('D:\\work')]]), ['E-', 'D--work-Projects-app']);
});

test('mapFolder uses the longest prefix at a folder boundary, and the old home folder', () => {
  const here = path.join(root, 'mapped');
  assert.equal(mapFolder('E:\\Projects\\app', [['E:\\Projects', here]], 'win32'), path.join(here, 'app'));
  assert.equal(mapFolder('e:/projects/app', [['E:\\Projects', here]], 'win32'), path.join(here, 'app'));
  assert.equal(mapFolder('/old/home/code', [], 'linux', '/old/home'), path.join(os.homedir(), 'code'));
  assert.equal(mapFolder('Q:\\none', [], 'win32'), null);
});
