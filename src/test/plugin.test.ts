import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { configFile, packageRoot } from '../paths.js';
import { isolate } from './helpers.js';

const root = isolate();
const pluginDir = path.join(packageRoot, 'plugin');
const hookScript = path.join(pluginDir, 'hooks', 'lavish-rule.mjs');
const board = path.join(pluginDir, 'skills', 'firstmate', 'board.js');
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
}

test('the marketplace lists one plugin, crewrota, whose manifest carries the package version', () => {
  const marketplace = readJson(path.join(packageRoot, '.claude-plugin', 'marketplace.json'));
  const manifest = readJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'));
  assert.equal(marketplace.name, 'crewrota');
  assert.equal(typeof marketplace.owner.name, 'string');
  assert.equal(marketplace.plugins.length, 1);
  const [entry] = marketplace.plugins;
  assert.equal(entry.name, 'crewrota');
  assert.match(entry.source, /^\.\//);
  assert.ok(fs.existsSync(path.join(packageRoot, entry.source, '.claude-plugin', 'plugin.json')));
  assert.equal(manifest.name, 'crewrota');
  assert.equal(manifest.version, readJson(path.join(packageRoot, 'package.json')).version);
});

test('the plugin has the firstmate skill files and a SessionStart hook that runs the Lavish rule script', () => {
  for (const file of ['SKILL.md', 'brief.md', 'readme-template.md', 'board.js']) assert.ok(fs.existsSync(path.join(pluginDir, 'skills', 'firstmate', file)), file);
  const skill = fs.readFileSync(path.join(pluginDir, 'skills', 'firstmate', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\r?\nname: firstmate\r?\n/);
  const hooks = readJson(path.join(pluginDir, 'hooks', 'hooks.json'));
  const [command] = hooks.hooks.SessionStart[0].hooks;
  assert.equal(command.type, 'command');
  assert.equal(command.command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/lavish-rule.mjs"');
});

test('the plugin stays neutral: no machine paths, no ccs, no dashes other than the plain hyphen', () => {
  for (const file of walk(pluginDir)) {
    const text = fs.readFileSync(file, 'utf8');
    const name = path.relative(pluginDir, file);
    assert.doesNotMatch(text, /[A-Z]:\\|[A-Z]:\/|\/Users\/|\.ccs\b|\bccs\b|\bccs-/, name);
    assert.doesNotMatch(text, new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`), name);
  }
});

function hook(env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [hookScript], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('the Lavish rule hook prints the rule, and nothing once crewrota config says lavishRule false', () => {
  const on = hook();
  assert.equal(on.status, 0);
  assert.match(on.stdout, /Lavish QA page in the task's review\/ folder/);
  assert.match(on.stdout, /questions\.md/);
  assert.match(on.stdout, /agents board before its first dispatch/);
  assert.match(on.stdout, /crew config lavish off/);

  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify({ skipPermissions: null, members: {}, lavishRule: false }));
  const off = hook();
  assert.equal(off.status, 0);
  assert.equal(off.stdout, '');

  fs.writeFileSync(configFile(), '{ not json');
  assert.match(hook().stdout, /Lavish QA page/);
  fs.rmSync(configFile());
});

test('board.js builds the agents board and a Markdown status file from a lane\'s own files', () => {
  const tree = path.join(root, 'tree');
  fs.mkdirSync(tree);
  execFileSync('git', ['init', '-q', '-b', 'crew/demo'], { cwd: tree });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'start'], { cwd: tree });
  fs.writeFileSync(path.join(tree, 'new.txt'), 'x');
  const evidence = path.join(root, 'evidence', 'lane-a');
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'run.json'), '[i] a crewrota note\n' + JSON.stringify({ is_error: false, result: 'Built the thing.', num_turns: 12, duration_ms: 600000, session_id: 's1' }));
  fs.writeFileSync(path.join(evidence, 'report.md'), '# report');
  const log = path.join(process.env.CREWROTA_HOME!, 'members', 'review', 'projects', tree.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(log, { recursive: true });
  const step = { type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_use', name: 'Bash', input: { description: 'Run the tests' } }] } };
  fs.writeFileSync(path.join(log, 'session.jsonl'), JSON.stringify(step) + '\n');
  const lanes = path.join(root, 'lanes.json');
  fs.writeFileSync(lanes, JSON.stringify({ title: 'Demo', plan: 'README.md', lanes: [
    { name: 'a', member: 'review', ship: 'team', job: 'Build the thing', worktree: tree, evidence, brief: 'brief.md' },
    { name: 'b', member: 'build', job: 'Not yet', worktree: tree, evidence: path.join(root, 'evidence', 'lane-b') },
  ] }));

  const html = path.join(root, 'review', 'board.html');
  const out = execFileSync(process.execPath, [board, lanes, html], { encoding: 'utf8' });
  assert.equal(out.trim(), 'a: finished | b: not started');
  const page = fs.readFileSync(html, 'utf8');
  assert.match(page, /data-lavish-annotate="off"/);
  assert.match(page, /Demo: all 2 lanes have ended|Demo: 0 of 2/);
  assert.match(page, /crew review/);
  assert.match(page, /<dt>Ship<\/dt><dd>team<\/dd>/);
  assert.match(page, /<dt>Branch<\/dt><dd>crew\/demo<\/dd>/);
  assert.match(page, /Built the thing\./);
  assert.match(page, /Run the tests/);
  assert.doesNotMatch(page, /ccs/);

  const md = path.join(root, 'review', 'board.md');
  execFileSync(process.execPath, [board, lanes, md], { encoding: 'utf8' });
  const status = fs.readFileSync(md, 'utf8');
  assert.match(status, /^# Demo: /);
  assert.match(status, /## Lane a: Finished/);
  assert.match(status, /- Member: crew review, ship team/);
  assert.match(status, /> Built the thing\./);
  assert.match(status, /## Lane b: Not started/);
});
