import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, saveConfig } from '../config.js';
import { type LaunchDeps, launch, launchArgs } from '../launch.js';
import { linkState } from '../links.js';
import { configFile, mainClaudeDir, mainClaudeJson, memberDir, shipProjectsDir } from '../paths.js';
import { writeShipMcp } from '../ships.js';
import { fakeMember, isolate } from './helpers.js';

isolate();
const config = loadConfig();
fakeMember(config, 'work');
saveConfig(config);
fs.rmSync(configFile());

test('launch argv carries model, effort and skip-permissions before the extra args', () => {
  assert.deepEqual(launchArgs({ model: 'opus', effort: 'xhigh' }, true, ['--resume']), [
    '--model', 'opus', '--effort', 'xhigh', '--dangerously-skip-permissions', '--resume',
  ]);
});

test('launch argv leaves out every flag that is at its default', () => {
  assert.deepEqual(launchArgs({ model: 'default', effort: 'default' }, false, []), []);
  assert.deepEqual(launchArgs({ model: 'claude-opus-5-5', effort: 'default' }, false, []), ['--model', 'claude-opus-5-5']);
});

function fakeDeps(answer: boolean | null, started = true) {
  const calls = { asked: 0, args: [] as string[][], dirs: [] as string[] };
  const deps: LaunchDeps = {
    askSkipPermissions: async () => {
      calls.asked++;
      return answer;
    },
    start: async (args, dir, onSpawn) => {
      calls.args.push(args);
      calls.dirs.push(dir);
      if (!started) return 1;
      onSpawn();
      return 0;
    },
  };
  return { calls, deps };
}

test('a cancelled skip-permissions question launches nothing and saves nothing', async () => {
  const { calls, deps } = fakeDeps(null);
  const code = await launch('work', { model: 'opus', effort: 'high' }, [], structuredClone(config), deps);
  assert.equal(code, null);
  assert.equal(calls.args.length, 0);
  assert.equal(fs.existsSync(configFile()), false);
});

test('nothing is saved when claude does not start', async () => {
  const { calls, deps } = fakeDeps(true, false);
  const code = await launch('work', { model: 'opus', effort: 'high' }, [], structuredClone(config), deps);
  assert.equal(code, 1);
  assert.equal(calls.args.length, 1);
  assert.equal(fs.existsSync(configFile()), false);
});

test('claude starts in the member folder; the skip-permissions question is asked once, then remembered', async () => {
  const first = fakeDeps(true);
  assert.equal(await launch('work', { model: 'opus', effort: 'high' }, [], structuredClone(config), first.deps), 0);
  assert.equal(first.calls.asked, 1);
  assert.deepEqual(first.calls.dirs, [memberDir('work')]);
  assert.deepEqual(first.calls.args[0], ['--model', 'opus', '--effort', 'high', '--dangerously-skip-permissions']);

  const saved = loadConfig();
  assert.equal(saved.skipPermissions, true);
  assert.equal(saved.members.work.model, 'opus');
  assert.equal(saved.members.work.effort, 'high');
  assert.equal(saved.lastModel, 'opus');

  const second = fakeDeps(false);
  await launch('work', { model: 'sonnet', effort: 'default' }, ['--resume'], loadConfig(), second.deps);
  assert.equal(second.calls.asked, 0);
  assert.deepEqual(second.calls.args[0], ['--model', 'sonnet', '--dangerously-skip-permissions', '--resume']);
});

test('the ship join and the shared items are in place before claude starts', async () => {
  const saved = loadConfig();
  saved.members.work.ship = 'team';
  saveConfig(saved);
  fs.mkdirSync(path.join(mainClaudeDir(), 'skills'), { recursive: true });
  fs.writeFileSync(path.join(mainClaudeDir(), 'settings.json'), '{"statusLine": {}}');

  let atStart: string[] = [];
  const deps: LaunchDeps = {
    askSkipPermissions: async () => false,
    start: async (_args, dir, onSpawn) => {
      atStart = [
        linkState(path.join(dir, 'projects'), shipProjectsDir('team')),
        linkState(path.join(dir, 'skills'), path.join(mainClaudeDir(), 'skills')),
        fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'),
      ];
      onSpawn();
      return 0;
    },
  };
  await launch('work', { model: 'default', effort: 'default' }, [], loadConfig(), deps);
  assert.deepEqual(atStart, ['ok', 'ok', '{"statusLine": {}}']);
});

test('a shared item that cannot be linked stops the launch with the reason', async () => {
  fs.mkdirSync(path.join(mainClaudeDir(), 'agents'), { recursive: true });
  fs.mkdirSync(path.join(memberDir('work'), 'agents'), { recursive: true });
  fs.writeFileSync(path.join(memberDir('work'), 'agents', 'own.md'), 'mine');
  const { calls, deps } = fakeDeps(false);
  await assert.rejects(launch('work', { model: 'default', effort: 'default' }, [], loadConfig(), deps), /agents is in the way .*Nothing launched/);
  assert.equal(calls.args.length, 0);
  assert.equal(fs.readFileSync(path.join(memberDir('work'), 'agents', 'own.md'), 'utf8'), 'mine');
});

test('a member with no ship gets the main tooling too, and a status line where the main setup has none', async () => {
  const saved = loadConfig();
  fakeMember(saved, 'plain');
  saveConfig(saved);
  fs.rmSync(path.join(mainClaudeDir(), 'settings.json'));
  const { deps } = fakeDeps(false);
  await launch('plain', { model: 'default', effort: 'default' }, [], loadConfig(), deps);
  assert.equal(linkState(path.join(memberDir('plain'), 'skills'), path.join(mainClaudeDir(), 'skills')), 'ok');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(memberDir('plain'), 'settings.json'), 'utf8')), {
    statusLine: { type: 'command', command: 'crewrota statusline' },
  });
});

test("a member on a ship launches with the ship's MCP servers, not the main ones", async () => {
  fs.rmSync(path.join(memberDir('work'), 'agents'), { recursive: true }); // left in the way by the test above
  fs.writeFileSync(mainClaudeJson(), JSON.stringify({ mcpServers: { mainonly: { command: 'main' } } }));
  writeShipMcp('team', { shiponly: { type: 'http', url: 'https://example.com/mcp' } });
  await launch('work', { model: 'default', effort: 'default' }, [], loadConfig(), fakeDeps(false).deps);
  const member = JSON.parse(fs.readFileSync(path.join(memberDir('work'), '.claude.json'), 'utf8'));
  assert.deepEqual(member.mcpServers, { shiponly: { type: 'http', url: 'https://example.com/mcp' } });
});

test('a no to Lavish telemetry launches claude with LAVISH_AXI_TELEMETRY=0, and nothing extra otherwise', async () => {
  const envs: NodeJS.ProcessEnv[] = [];
  const deps: LaunchDeps = {
    askSkipPermissions: async () => false,
    start: async (_args, _dir, onSpawn, extraEnv) => {
      envs.push(extraEnv);
      onSpawn();
      return 0;
    },
  };
  await launch('work', { model: 'default', effort: 'default' }, [], { ...loadConfig(), lavishTelemetry: false }, deps);
  await launch('work', { model: 'default', effort: 'default' }, [], { ...loadConfig(), lavishTelemetry: true }, deps);
  await launch('work', { model: 'default', effort: 'default' }, [], loadConfig(), deps);
  assert.deepEqual(envs, [{ LAVISH_AXI_TELEMETRY: '0' }, {}, {}]);
});
