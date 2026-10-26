import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { initProject, templateDir } from '../init.js';
import { cliPath, isolate } from './helpers.js';

const root = isolate();

const EXPECTED = ['.claude/CLAUDE.md', '.claude/crewrota.json', '.claude/memories/README.md', '.claude/skills/README.md', '.claude/tasks/INDEX.md'].map((file) => path.normalize(file));

test('init writes the root .claude/ from the template, and a second run leaves every file alone', () => {
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  const first = initProject(project);
  assert.deepEqual(first.created, EXPECTED);
  assert.deepEqual(first.kept, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, '.claude', 'crewrota.json'), 'utf8')), { version: 1, routing: [] });
  assert.equal(fs.readFileSync(path.join(project, '.claude', 'tasks', 'INDEX.md'), 'utf8'), fs.readFileSync(path.join(templateDir, 'tasks', 'INDEX.md'), 'utf8'));

  fs.writeFileSync(path.join(project, '.claude', 'memories', 'README.md'), 'mine');
  const second = initProject(project);
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.kept, EXPECTED.map((file) => `${file} (already there)`));
  assert.equal(fs.readFileSync(path.join(project, '.claude', 'memories', 'README.md'), 'utf8'), 'mine');
});

test('init writes no .claude/CLAUDE.md when the project already has a CLAUDE.md, and fills in only what is missing', () => {
  const project = path.join(root, 'has-rules');
  fs.mkdirSync(path.join(project, '.claude', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# rules');
  fs.writeFileSync(path.join(project, '.claude', 'tasks', 'INDEX.md'), 'my index');
  const { created, kept } = initProject(project);
  assert.deepEqual(created, EXPECTED.filter((file) => !file.endsWith('CLAUDE.md') && !file.endsWith('INDEX.md')));
  assert.deepEqual(kept, [path.normalize('.claude/CLAUDE.md (the project has a CLAUDE.md)'), path.normalize('.claude/tasks/INDEX.md (already there)')]);
  assert.equal(fs.existsSync(path.join(project, '.claude', 'CLAUDE.md')), false);
  assert.equal(fs.readFileSync(path.join(project, '.claude', 'tasks', 'INDEX.md'), 'utf8'), 'my index');
});

test('crew init works in the current folder and says what it created and what it left alone', () => {
  const project = path.join(root, 'cli-project');
  fs.mkdirSync(project);
  const run = () => spawnSync(process.execPath, [cliPath, 'init'], { cwd: project, encoding: 'utf8', env: process.env });
  const first = run();
  assert.equal(first.status, 0);
  for (const file of EXPECTED) assert.ok(first.stdout.includes(`created ${file}`), file);
  assert.match(first.stdout, /\.claude\/ folder is ready/);
  const second = run();
  assert.equal(second.status, 0);
  assert.doesNotMatch(second.stdout, /created/);
  assert.match(second.stdout, /Nothing to create/);
  assert.equal((second.stdout.match(/left alone/g) ?? []).length, EXPECTED.length);
  assert.match(spawnSync(process.execPath, [cliPath, 'init', 'extra'], { cwd: project, encoding: 'utf8' }).stderr, /Usage: crew init/);
});
