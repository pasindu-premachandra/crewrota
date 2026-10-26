import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { type Config, loadConfig } from '../config.js';
import { linkState } from '../links.js';
import { mainClaudeJson, memberDir, shipDir, shipProjectsDir } from '../paths.js';
import { SHIP_FOLDERS, createShip, healShipLink, importIntoShip, joinShip, leaveShip, listShips, readShipMcp, renameShip, shipFolder, shipMembers, writeShipMcp } from '../ships.js';
import { fakeMember, isolate } from './helpers.js';

isolate();

const config: Config = { skipPermissions: null, members: {} };
const dir = fakeMember(config, 'work');
const projects = path.join(dir, 'projects');
const ship = shipProjectsDir('team');

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test('link points projects/ at the ship, copies existing files in and keeps the old folder', () => {
  write(path.join(projects, 'E--code-app', 'one.jsonl'), 'member one');
  write(path.join(projects, 'E--code-app', 'two.jsonl'), 'member two');
  write(path.join(ship, 'E--code-app', 'one.jsonl'), 'ship one');

  const notes = joinShip(config, 'work', 'team');

  assert.equal(config.members.work.ship, 'team');
  assert.ok(fs.lstatSync(projects).isSymbolicLink());
  assert.equal(linkState(projects, ship), 'ok');
  assert.equal(fs.readFileSync(path.join(ship, 'E--code-app', 'one.jsonl'), 'utf8'), 'ship one');
  assert.equal(fs.readFileSync(path.join(ship, 'E--code-app', 'one.incoming-1.jsonl'), 'utf8'), 'member one');
  assert.equal(fs.readFileSync(path.join(ship, 'E--code-app', 'two.jsonl'), 'utf8'), 'member two');

  const kept = fs.readdirSync(dir).filter((name) => name.startsWith('projects.before-crewrota-'));
  assert.equal(kept.length, 1);
  assert.match(kept[0], /^projects\.before-crewrota-\d{8}$/);
  assert.equal(fs.readFileSync(path.join(dir, kept[0], 'E--code-app', 'one.jsonl'), 'utf8'), 'member one');
  assert.match(notes.join('\n'), /original folder is kept/);
});

test('heal re-makes a missing ship folder, and a missing link', () => {
  fs.rmSync(shipDir('team'), { recursive: true });
  assert.equal(linkState(projects, ship), 'dangling');
  healShipLink(config, 'work');
  assert.equal(linkState(projects, ship), 'ok');

  fs.unlinkSync(projects);
  assert.equal(linkState(projects, ship), 'missing');
  healShipLink(config, 'work');
  assert.equal(linkState(projects, ship), 'ok');
});

test('unlink removes only the link, leaves an empty projects/ and keeps the ship files', () => {
  write(path.join(ship, 'E--code-app', 'kept.jsonl'), 'ship file');
  config.members.work.model = 'opus';

  leaveShip(config, 'work');

  assert.equal(config.members.work.ship, undefined);
  assert.equal(config.members.work.model, 'opus');
  const stat = fs.lstatSync(projects);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.deepEqual(fs.readdirSync(projects), []);
  assert.equal(fs.readFileSync(path.join(ship, 'E--code-app', 'kept.jsonl'), 'utf8'), 'ship file');
});

test('a member folder with no projects/ yet gets the link straight away', () => {
  fakeMember(config, 'fresh');
  joinShip(config, 'fresh', 'team');
  assert.equal(linkState(path.join(memberDir('fresh'), 'projects'), ship), 'ok');
});

test('ship rename moves the folder and re-points every member link', () => {
  joinShip(config, 'work', 'team');

  const notes = renameShip(config, 'team', 'crew');

  assert.deepEqual(notes, []);
  assert.equal(fs.existsSync(shipDir('team')), false);
  assert.deepEqual(shipMembers(config, 'crew'), ['fresh', 'work']);
  assert.deepEqual(shipMembers(loadConfig(), 'crew'), ['fresh', 'work']);
  for (const member of ['work', 'fresh']) {
    assert.equal(linkState(path.join(memberDir(member), 'projects'), shipProjectsDir('crew')), 'ok');
  }
  assert.equal(fs.readFileSync(path.join(shipProjectsDir('crew'), 'E--code-app', 'kept.jsonl'), 'utf8'), 'ship file');
  assert.deepEqual(listShips(config), ['crew']);
});

test('a ship shares the session folders too; a member\'s own todos are moved aside, kept and copied in', () => {
  fakeMember(config, 'busy');
  write(path.join(memberDir('busy'), 'todos', 'mine.json'), 'my todo');
  fs.mkdirSync(path.join(memberDir('busy'), 'session-env'), { recursive: true });

  const notes = joinShip(config, 'busy', 'crew');

  for (const name of SHIP_FOLDERS) assert.equal(linkState(path.join(memberDir('busy'), name), shipFolder('crew', name)), 'ok', name);
  assert.equal(fs.readFileSync(path.join(shipFolder('crew', 'todos'), 'mine.json'), 'utf8'), 'my todo');
  assert.equal(notes.filter((note) => note.includes('todos')).length, 1);
  assert.equal(notes.some((note) => note.includes('session-env')), false); // an empty folder just makes way
  const aside = fs.readdirSync(memberDir('busy')).find((name) => name.startsWith('todos.before-crewrota-'))!;
  assert.equal(fs.readFileSync(path.join(memberDir('busy'), aside, 'mine.json'), 'utf8'), 'my todo');

  leaveShip(config, 'busy');
  for (const name of SHIP_FOLDERS) assert.equal(linkState(path.join(memberDir('busy'), name), shipFolder('crew', name)), 'not-a-link', name);
});

test('a new ship starts with a copy of the main MCP servers, and keeps its own list after that', () => {
  fs.writeFileSync(mainClaudeJson(), JSON.stringify({ mcpServers: { playwright: { command: 'npx' } } }));
  createShip('tools');
  assert.deepEqual(readShipMcp('tools'), { playwright: { command: 'npx' } });
  writeShipMcp('tools', { stripe: { type: 'http', url: 'https://mcp.stripe.com' } });
  fs.writeFileSync(mainClaudeJson(), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
  assert.deepEqual(readShipMcp('tools'), { stripe: { type: 'http', url: 'https://mcp.stripe.com' } });
});

test('import copies a ccs-style group into a ship, and a second run adds only what is new', () => {
  const group = path.join(path.dirname(shipDir('crew')), '..', 'ccs-group');
  write(path.join(group, 'projects', 'E--code-app', 'old.jsonl'), 'line 1\n');
  write(path.join(group, 'projects', 'E--code-app', 'memory', 'MEMORY.md'), 'remembered');
  write(path.join(group, 'continuity', 'file-history', 'abc', 'v1'), 'checkpoint');
  createShip('imported');

  const first = importIntoShip('imported', group);
  assert.deepEqual(first.projects, { copied: 2, updated: 0, kept: 0, skipped: 0 });
  assert.deepEqual(first['file-history'], { copied: 1, updated: 0, kept: 0, skipped: 0 });
  assert.equal(first.todos, undefined);
  assert.equal(fs.readFileSync(path.join(shipFolder('imported', 'projects'), 'E--code-app', 'memory', 'MEMORY.md'), 'utf8'), 'remembered');

  fs.appendFileSync(path.join(group, 'projects', 'E--code-app', 'old.jsonl'), 'line 2\n');
  write(path.join(group, 'projects', 'E--code-app', 'new.jsonl'), 'new');
  write(path.join(shipFolder('imported', 'projects'), 'E--code-app', 'memory', 'MEMORY.md'), 'changed in the ship');
  const second = importIntoShip('imported', group);
  assert.deepEqual(second.projects, { copied: 1, updated: 1, kept: 1, skipped: 0 });
  assert.equal(fs.readFileSync(path.join(shipFolder('imported', 'projects'), 'E--code-app', 'old.jsonl'), 'utf8'), 'line 1\nline 2\n');
  assert.equal(fs.readFileSync(path.join(shipFolder('imported', 'projects'), 'E--code-app', 'memory', 'MEMORY.md'), 'utf8'), 'changed in the ship');
  assert.equal(fs.readFileSync(path.join(shipFolder('imported', 'projects'), 'E--code-app', 'memory', 'MEMORY.incoming-1.md'), 'utf8'), 'remembered');
  assert.deepEqual(importIntoShip('imported', group).projects, { copied: 0, updated: 0, kept: 0, skipped: 3 });
  assert.equal(fs.existsSync(path.join(shipFolder('imported', 'projects'), 'E--code-app', 'memory', 'MEMORY.incoming-2.md')), false);
  assert.equal(fs.readFileSync(path.join(group, 'projects', 'E--code-app', 'memory', 'MEMORY.md'), 'utf8'), 'remembered');
});
