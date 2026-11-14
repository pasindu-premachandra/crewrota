import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { configDir, configFile, crewHome, mainClaudeDir, mainClaudeJson, memberDir, membersDir, packageRoot, removedDir, samePath, shipDir, shipProjectsDir, shipsDir } from '../paths.js';
import { isolate, onPlatform } from './helpers.js';

const root = isolate();

function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

test('on Windows the config lives under APPDATA, or under the home folder without it', () => {
  onPlatform('win32', () => {
    assert.equal(configDir(), path.join(process.env.APPDATA!, 'crewrota'));
    assert.equal(configFile(), path.join(process.env.APPDATA!, 'crewrota', 'config.json'));
    for (const value of [undefined, '']) {
      withEnv('APPDATA', value, () => assert.equal(configDir(), path.join(os.homedir(), 'AppData', 'Roaming', 'crewrota')));
    }
  });
});

test('elsewhere the config lives under an absolute XDG_CONFIG_HOME, or ~/.config without one', () => {
  onPlatform('linux', () => {
    assert.equal(configDir(), path.join(process.env.XDG_CONFIG_HOME!, 'crewrota'));
    for (const value of [undefined, '', 'relative/config']) {
      withEnv('XDG_CONFIG_HOME', value, () => assert.equal(configDir(), path.join(os.homedir(), '.config', 'crewrota')));
    }
  });
});

test('a relative CREWROTA_HOME is made absolute, and an empty one counts as unset', () => {
  withEnv('CREWROTA_HOME', 'relative-home', () => assert.equal(crewHome(), path.resolve('relative-home')));
  withEnv('CREWROTA_HOME', '', () => assert.equal(crewHome(), path.join(os.homedir(), '.crewrota')));
});

test('members, ships and removed folders all sit under the crewrota home', () => {
  const home = process.env.CREWROTA_HOME!;
  assert.equal(membersDir(), path.join(home, 'members'));
  assert.equal(memberDir('work'), path.join(home, 'members', 'work'));
  assert.equal(shipsDir(), path.join(home, 'ships'));
  assert.equal(shipDir('team'), path.join(home, 'ships', 'team'));
  assert.equal(shipProjectsDir('team'), path.join(home, 'ships', 'team', 'projects'));
  assert.equal(removedDir(), path.join(home, 'removed'));
});

test('the main setup paths follow the home folder, which the tests keep under their temp folder', () => {
  assert.equal(mainClaudeDir(), path.join(os.homedir(), '.claude'));
  assert.equal(mainClaudeJson(), path.join(os.homedir(), '.claude.json'));
  assert.ok(mainClaudeDir().startsWith(root));
  assert.ok(mainClaudeJson().startsWith(root));
});

test('packageRoot is the folder with crewrota\'s package.json', () => {
  assert.equal(JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).name, 'crewrota');
});

test('samePath ignores the way a path is written', () => {
  assert.equal(samePath(path.join(root, 'a', '..', 'b'), path.join(root, 'b')), true);
  assert.equal(samePath(path.join(root, 'b') + path.sep, path.join(root, 'b')), true);
  assert.equal(samePath('relative', path.resolve('relative')), true);
  assert.equal(samePath(path.join(root, 'a'), path.join(root, 'b')), false);
});

test('samePath ignores case on Windows only', () => {
  const lower = path.join(root, 'folder');
  const upper = path.join(root, 'FOLDER');
  assert.equal(onPlatform('win32', () => samePath(lower, upper)), true);
  assert.equal(onPlatform('linux', () => samePath(lower, upper)), false);
});
