import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, saveConfig } from '../config.js';
import { type LinkRunner, addShortcut, launcherFile, openShortcut, parseHotkey, removeShortcut, repointShortcuts, setShortcut, workspaceFile } from '../shortcuts.js';
import { cliPath, fakeMember, isolate } from './helpers.js';

const root = isolate();
process.env.CREWROTA_CODE = process.execPath; // never real VS Code
const project = path.join(root, 'project');
const other = path.join(root, 'other');
fs.mkdirSync(project);
fs.mkdirSync(other);
const slashed = (folder: string) => path.resolve(folder).replace(/\\/g, '/');

// Stands in for PowerShell: records what the .lnk would hold, in the temp Start Menu.
const links: Record<string, string>[] = [];
const fakeLink: LinkRunner = (env) => {
  links.push(env);
  fs.writeFileSync(env.CREW_LINK, JSON.stringify(env));
};

function cli(args: string[]) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', env: process.env });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const config = loadConfig();
fakeMember(config, 'work');
fakeMember(config, 'home');
saveConfig(config);

test('list with no shortcuts says how to add one', () => {
  const { code, out } = cli(['shortcut', 'list']);
  assert.equal(code, 0);
  assert.equal(out.trim(), 'No shortcuts yet. Add one with: crew shortcut add <name> --member <m> --folder <path>');
});

test('add writes the workspace file, the config entry and, on Windows, the Start Menu entry', () => {
  const added = addShortcut(config, 'site', { member: 'work', folder: project, hotkey: 'ctrl+alt+c' }, fakeLink);
  assert.deepEqual(added, { name: 'site', member: 'work', folder: slashed(project), hotkey: 'CTRL+ALT+C' });
  assert.deepEqual(loadConfig().shortcuts, [added]);
  assert.ok(workspaceFile('site').startsWith(path.join(process.env.CREWROTA_HOME!, 'shortcuts')));
  assert.deepEqual(JSON.parse(fs.readFileSync(workspaceFile('site'), 'utf8')), {
    folders: [{ path: slashed(project) }],
    settings: { 'terminal.integrated.defaultLocation': 'editor' },
    tasks: {
      version: '2.0.0',
      tasks: [
        {
          label: 'crew work',
          type: 'shell',
          command: 'crew work',
          options: { cwd: slashed(project) },
          runOptions: { runOn: 'folderOpen' },
          presentation: { reveal: 'always', panel: 'dedicated', focus: true },
          problemMatcher: [],
        },
      ],
    },
  });
  if (process.platform !== 'win32') {
    assert.deepEqual(links, []);
    return;
  }
  assert.ok(launcherFile('site').startsWith(process.env.APPDATA!));
  assert.equal(path.basename(path.dirname(launcherFile('site'))), 'Programs');
  assert.deepEqual(links.pop(), {
    CREW_LINK: launcherFile('site'),
    CREW_TARGET: process.execPath,
    CREW_ARGS: `"${workspaceFile('site')}"`,
    CREW_FOLDER: slashed(project),
    CREW_DESCRIPTION: 'crew work',
    CREW_HOTKEY: 'CTRL+ALT+C',
  });
});

test('add refuses a bad name, a duplicate, an unknown member, a missing folder and a bad hotkey', () => {
  assert.throws(() => addShortcut(config, 'Bad', { member: 'work', folder: project }, fakeLink), /not a valid shortcut name/);
  assert.throws(() => addShortcut(config, 'site', { member: 'work', folder: project }, fakeLink), /already exists\. Change it with: crew shortcut set site/);
  assert.throws(() => addShortcut(config, 'x', { member: 'nobody', folder: project }, fakeLink), /Crew member nobody doesn't exist/);
  assert.throws(() => addShortcut(config, 'x', { member: 'work', folder: path.join(root, 'none') }, fakeLink), /is not a folder/);
  assert.throws(() => addShortcut(config, 'x', { member: 'work', folder: project, hotkey: 'C' }, fakeLink), /such as CTRL\+ALT\+C/);
  if (process.platform === 'win32') {
    fs.mkdirSync(path.dirname(launcherFile('notes')), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(launcherFile('notes')), 'Notes.lnk'), 'not ours');
    assert.throws(() => addShortcut(config, 'notes', { member: 'work', folder: project }, fakeLink), /already has .+Pick another name/);
    assert.equal(fs.readFileSync(path.join(path.dirname(launcherFile('notes')), 'Notes.lnk'), 'utf8'), 'not ours');
  }
  assert.equal(fs.existsSync(workspaceFile('x')), false);
  assert.equal(loadConfig().shortcuts!.length, 1);
});

test('a hotkey is one or more of CTRL, ALT and SHIFT, then a letter, digit or F1 to F12', () => {
  assert.equal(parseHotkey('Ctrl+Shift+F12'), 'CTRL+SHIFT+F12');
  assert.equal(parseHotkey('alt+7'), 'ALT+7');
  for (const bad of ['CTRL+', 'CTRL+F13', 'WIN+C', 'CTRL+ALT+CC', 'CTRL ALT C']) assert.throws(() => parseHotkey(bad), /CTRL\+ALT\+C/, bad);
});

test('set changes only the flags given, and --no-hotkey drops the hotkey', () => {
  const moved = setShortcut(config, 'site', { folder: other }, fakeLink);
  assert.deepEqual(moved, { name: 'site', member: 'work', folder: slashed(other), hotkey: 'CTRL+ALT+C' });
  const cleared = setShortcut(config, 'site', { member: 'home', hotkey: null }, fakeLink);
  assert.deepEqual(cleared, { name: 'site', member: 'home', folder: slashed(other) });
  assert.deepEqual(loadConfig().shortcuts, [cleared]);
  const file = JSON.parse(fs.readFileSync(workspaceFile('site'), 'utf8'));
  assert.equal(file.tasks.tasks[0].command, 'crew home');
  assert.equal(file.folders[0].path, slashed(other));
  if (process.platform === 'win32') assert.equal(links.pop()!.CREW_HOTKEY, '');
  assert.throws(() => setShortcut(config, 'nothing', {}, fakeLink), /Shortcut nothing doesn't exist/);
});

test('open starts VS Code on the workspace file', () => {
  const started: [string, string[]][] = [];
  assert.equal(openShortcut(config, 'site', (command, args) => started.push([command, args])), process.execPath);
  assert.deepEqual(started, [[process.execPath, [workspaceFile('site')]]]);
});

test('repointing moves a member\'s shortcuts to its new name and rewrites their files', () => {
  assert.deepEqual(repointShortcuts(config, 'nobody', 'x', fakeLink), []);
  const moved = repointShortcuts(config, 'home', 'personal', fakeLink);
  assert.deepEqual(moved.map((shortcut) => shortcut.member), ['personal']);
  assert.equal(loadConfig().shortcuts![0].member, 'personal');
  assert.equal(JSON.parse(fs.readFileSync(workspaceFile('site'), 'utf8')).tasks.tasks[0].label, 'crew personal');
  repointShortcuts(config, 'personal', 'home', fakeLink);
});

test('remove deletes the workspace file, the Start Menu entry and the config entry', () => {
  removeShortcut(config, 'site');
  assert.equal(fs.existsSync(workspaceFile('site')), false);
  assert.equal(fs.existsSync(launcherFile('site')), false);
  assert.deepEqual(loadConfig().shortcuts, []);
  assert.throws(() => removeShortcut(config, 'site'), /Shortcut site doesn't exist/);
});

test('through the command line: add, list, rename and drop carry the shortcut along', () => {
  const added = cli(['shortcut', 'add', 'job', '--member', 'work', '--folder', project]);
  assert.equal(added.code, 0, added.err);
  assert.match(added.out, /Shortcut job opens .* in VS Code and runs crew work there\./);
  if (process.platform === 'win32') assert.ok(fs.existsSync(launcherFile('job')));
  assert.match(cli(['shortcut', 'list']).out, new RegExp(`job  crew work  ${slashed(project)}`));

  assert.equal(cli(['rename', 'work', 'office']).code, 0);
  assert.match(cli(['shortcut', 'list']).out, /job  crew office/);
  assert.equal(JSON.parse(fs.readFileSync(workspaceFile('job'), 'utf8')).tasks.tasks[0].command, 'crew office');

  const dropped = cli(['drop', 'office', '--yes']);
  assert.equal(dropped.code, 0, dropped.err);
  assert.match(dropped.out, /Shortcuts: job \(removed with it\)/);
  assert.equal(fs.existsSync(workspaceFile('job')), false);
  assert.equal(fs.existsSync(launcherFile('job')), false);
  assert.deepEqual(loadConfig().shortcuts, []);
});

test('the command line refuses an unknown action and --hotkey with --no-hotkey', () => {
  assert.match(cli(['shortcut', 'launch', 'job']).err, /Usage: crew shortcut add\|list\|set\|remove\|open/);
  assert.match(cli(['shortcut', 'set', 'job', '--hotkey', 'CTRL+ALT+J', '--no-hotkey']).err, /Usage: crew shortcut/);
});
