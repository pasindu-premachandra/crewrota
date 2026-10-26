import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, recordChoice, rememberedChoice, saveConfig, switchTo } from '../config.js';
import { configFile, crewHome, memberDir, shipProjectsDir } from '../paths.js';
import { fakeMember, isolate } from './helpers.js';

const root = isolate();

test('the config file lives in APPDATA on Windows and XDG_CONFIG_HOME elsewhere', () => {
  const base = process.platform === 'win32' ? process.env.APPDATA! : process.env.XDG_CONFIG_HOME!;
  assert.equal(configFile(), path.join(base, 'crewrota', 'config.json'));
  assert.ok(configFile().startsWith(root));
});

test('the crewrota home is CREWROTA_HOME, else .crewrota in the home folder', () => {
  assert.equal(crewHome(), path.join(root, 'crew-home'));
  assert.equal(memberDir('work'), path.join(root, 'crew-home', 'members', 'work'));
  assert.equal(shipProjectsDir('team'), path.join(root, 'crew-home', 'ships', 'team', 'projects'));
  const saved = process.env.CREWROTA_HOME;
  delete process.env.CREWROTA_HOME;
  try {
    assert.equal(crewHome(), path.join(os.homedir(), '.crewrota'));
    assert.ok(crewHome().startsWith(root));
  } finally {
    process.env.CREWROTA_HOME = saved;
  }
});

test('a fresh config has skipPermissions null and no members', () => {
  assert.deepEqual(loadConfig(), { skipPermissions: null, members: {} });
});

test('model and effort are remembered per member, and a new member falls back to the last choice', () => {
  const config = loadConfig();
  fakeMember(config, 'work');
  fakeMember(config, 'home');
  fakeMember(config, 'fresh');
  assert.deepEqual(rememberedChoice(config, 'fresh'), { model: 'default', effort: 'default' });

  recordChoice(config, 'work', { model: 'opus', effort: 'high' });
  recordChoice(config, 'home', { model: 'sonnet', effort: 'low' });
  saveConfig(config);

  const reloaded = loadConfig();
  assert.deepEqual(rememberedChoice(reloaded, 'work'), { model: 'opus', effort: 'high' });
  assert.deepEqual(rememberedChoice(reloaded, 'home'), { model: 'sonnet', effort: 'low' });
  assert.deepEqual(rememberedChoice(reloaded, 'fresh'), { model: 'sonnet', effort: 'low' });
  assert.equal(reloaded.members.work.provider, 'claude');
  assert.ok(fs.existsSync(configFile()));
});

test('switching keeps the previous member', () => {
  const config = loadConfig();
  switchTo(config, 'work');
  switchTo(config, 'home');
  switchTo(config, 'home');
  assert.equal(config.current, 'home');
  assert.equal(config.previous, 'work');
});

test('the Lavish rule and telemetry answers survive a save, and stay unset until given', () => {
  const config = loadConfig();
  assert.equal('lavishRule' in config, false);
  assert.equal('lavishTelemetry' in config, false);
  config.lavishRule = false;
  config.lavishTelemetry = false;
  saveConfig(config);
  const reloaded = loadConfig();
  assert.equal(reloaded.lavishRule, false);
  assert.equal(reloaded.lavishTelemetry, false);
  reloaded.lavishRule = true;
  reloaded.lavishTelemetry = true;
  saveConfig(reloaded);
  assert.equal('lavishRule' in loadConfig(), false);
  assert.equal(loadConfig().lavishTelemetry, true);
});
