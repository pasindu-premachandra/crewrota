import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { backup, projectSlug, remapName, tarPath } from '../backup.js';
import { loadConfig, saveConfig } from '../config.js';
import { linkState } from '../links.js';
import { memberDir, shipDir } from '../paths.js';
import { createShip, joinShip, shipFolder, writeShipMcp } from '../ships.js';
import { cliPath, fakeMember, isolate } from './helpers.js';

const root = isolate();
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

test('backup writes one zip with manifest.json, config.json and the ships, nothing from members/', { skip: noTar }, () => {
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
  assert.equal(path.basename(backup(loadConfig(), options, () => {})), 'crewrota-backup-20261026-0905.zip');
  assert.throws(() => backup(loadConfig(), options, () => {}), /already exists/);
  const manifest = JSON.parse(spawnSync(tarPath(), ['-x', '-O', '-f', zip, 'manifest.json'], { encoding: 'utf8' }).stdout);
  assert.equal(manifest.format, 1);
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
  assert.ok(help.includes('crew backup [--to <folder>] [--password]'));
  assert.ok(help.includes('crew restore <zip> [--map <old>=<new>]... [--password]'));
});
