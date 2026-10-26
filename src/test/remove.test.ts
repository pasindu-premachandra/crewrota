import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, saveConfig } from '../config.js';
import { findLinks } from '../links.js';
import { removalImpact, removeMember, renameMember } from '../members.js';
import { mainClaudeDir, memberDir, removedDir, shipProjectsDir } from '../paths.js';
import { syncSharedItems } from '../shared.js';
import { joinShip } from '../ships.js';
import { fakeMember, isolate } from './helpers.js';

isolate();

fs.mkdirSync(path.join(mainClaudeDir(), 'skills', 'kept'), { recursive: true });
fs.writeFileSync(path.join(mainClaudeDir(), 'skills', 'kept', 'SKILL.md'), 'main skill');
const config = loadConfig();
const dir = fakeMember(config, 'work');
fakeMember(config, 'home');
config.current = 'home';
joinShip(config, 'work', 'team');
syncSharedItems(dir, undefined);
fs.writeFileSync(path.join(shipProjectsDir('team'), 'session.jsonl'), 'ship history');
saveConfig(config);

test('the impact names the folder and the ship, and counts session files only when isolated', () => {
  assert.deepEqual(removalImpact(config, 'work'), [`Folder: ${dir}`, 'Ship: team (the ship keeps its history)']);
  fs.mkdirSync(path.join(memberDir('home'), 'projects', 'E--code'), { recursive: true });
  fs.writeFileSync(path.join(memberDir('home'), 'projects', 'E--code', 'a.jsonl'), '');
  fs.writeFileSync(path.join(memberDir('home'), 'projects', 'E--code', 'b.jsonl'), '');
  assert.equal(removalImpact(config, 'home')[2], 'Session files in its projects folder: 2');
});

test('remove unlinks every link first, then moves the folder to removed/, and the ship keeps its files', () => {
  assert.equal(findLinks(dir).length, 6); // the five ship folders and skills
  const movedTo = removeMember(config, 'work');

  assert.ok(movedTo);
  assert.equal(path.dirname(movedTo), removedDir());
  assert.match(path.basename(movedTo), /^work-\d{8}-\d{4}$/);
  assert.equal(fs.existsSync(dir), false);
  assert.deepEqual(findLinks(movedTo), []);
  assert.equal(fs.existsSync(path.join(movedTo, '.claude.json')), true);
  assert.equal(fs.readFileSync(path.join(shipProjectsDir('team'), 'session.jsonl'), 'utf8'), 'ship history');
  assert.equal(fs.readFileSync(path.join(mainClaudeDir(), 'skills', 'kept', 'SKILL.md'), 'utf8'), 'main skill');
  assert.equal(loadConfig().members.work, undefined);
});

test('rename moves the folder and every reference to the member', () => {
  const saved = loadConfig();
  saved.previous = 'home';
  renameMember(saved, 'home', 'personal');
  const after = loadConfig();
  assert.equal(after.members.home, undefined);
  assert.ok(after.members.personal);
  assert.equal(after.current, 'personal');
  assert.equal(after.previous, 'personal');
  assert.equal(fs.existsSync(memberDir('home')), false);
  assert.equal(fs.readdirSync(path.join(memberDir('personal'), 'projects', 'E--code')).length, 2);
  assert.throws(() => renameMember(loadConfig(), 'personal', 'Bad'), /not a valid crew member name/);
  assert.throws(() => renameMember(loadConfig(), 'nobody', 'other'), /Crew member nobody doesn't exist/);
});
