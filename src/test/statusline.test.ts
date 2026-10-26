import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { probeRateLimits, rateLimitsFrom, rateLimitsFromQuotaAxi, readRateLimits } from '../claude.js';
import { readQuota } from '../rows.js';
import { STATUS_COMMAND, ensureStatusLine, statusText, writeQuota } from '../statusline.js';
import { cliPath, isolate, readLog } from './helpers.js';

const root = isolate();
const NOW = Date.UTC(2026, 9, 26, 0, 0, 0);
const payload = (five?: number, week?: number) => ({
  model: { display_name: 'Opus 5' },
  rate_limits: {
    ...(five === undefined ? {} : { five_hour: { used_percentage: five, resets_at: NOW / 1000 + 3600 } }),
    ...(week === undefined ? {} : { seven_day: { used_percentage: week, resets_at: NOW / 1000 + 86400 } }),
  },
});

function folder(name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const quotaOf = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'quota.json'), 'utf8'));

test('the rate limits from Claude Code are saved to quota.json', () => {
  const dir = folder('fresh');
  assert.equal(writeQuota(dir, payload(42, 31), NOW), true);
  assert.deepEqual(quotaOf(dir), {
    ts: NOW / 1000,
    seen: NOW / 1000,
    five_hour_pct: 42,
    seven_day_pct: 31,
    five_hour_resets_at: NOW / 1000 + 3600,
    seven_day_resets_at: NOW / 1000 + 86400,
  });
  assert.deepEqual(readQuota(dir, NOW), { fiveHour: 42, week: 31 });
});

test('a window missing from the payload keeps its last reading, and no rate limits writes nothing', () => {
  const dir = folder('partial');
  writeQuota(dir, payload(42, 31), NOW);
  writeQuota(dir, payload(50), NOW + 1000);
  assert.equal(quotaOf(dir).five_hour_pct, 50);
  assert.equal(quotaOf(dir).seven_day_pct, 31);
  assert.equal(writeQuota(folder('none'), payload(), NOW), false);
  assert.equal(fs.existsSync(path.join(root, 'none', 'quota.json')), false);
});

test('an older session redrawing its last reading does not overwrite a newer one', () => {
  const dir = folder('stale');
  writeQuota(dir, payload(70, 40), NOW);
  const transcript = path.join(dir, 'old-session.jsonl');
  fs.writeFileSync(transcript, '');
  fs.utimesSync(transcript, (NOW - 3_600_000) / 1000, (NOW - 3_600_000) / 1000);
  assert.equal(writeQuota(dir, { ...payload(10, 5), transcript_path: transcript }, NOW + 1000), false);
  assert.equal(quotaOf(dir).five_hour_pct, 70);
});

test('a window whose reset time has passed reads as 0%', () => {
  const dir = folder('reset');
  writeQuota(dir, payload(90, 60), NOW);
  assert.deepEqual(readQuota(dir, NOW + 2 * 3_600_000), { fiveHour: 0, week: 60 });
});

test('the status line shows model, context, branch, both windows, the 5-hour reset, folder and member', () => {
  const noColour = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  const at = new Date(NOW + 3_600_000);
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const input = { ...payload(42.4, 31), model: { display_name: 'Opus 5 (1M context)' }, context_window: { used_percentage: 73 }, workspace: { current_dir: 'E:/code/crewrota-site' } };
  assert.equal(
    statusText('crew work', input, NOW, () => 'main'),
    `Opus 5 (1M) | ███████░░░ 73% | \ue0a0 main | 5h:42% | 7d:31% | ↻ ${clock} (1h00m) | crewrota-site | crew work`,
  );
  assert.equal(statusText('crew work', {}, NOW, () => ''), 'crew work');
  if (noColour === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = noColour;
});

test('the status line colours each part the way the main setup does', () => {
  const line = statusText('crew work', payload(85, 20), NOW, () => '');
  assert.match(line, /\x1b\[31m5h:85%/);
  assert.match(line, /\x1b\[32m7d:20%/);
  assert.match(line, /\x1b\[1m\x1b\[34mcrew work/);
});

test('a member with no status line gets crewrota\'s; its other settings stay', () => {
  const dir = folder('settings-none');
  ensureStatusLine(dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')), { statusLine: { type: 'command', command: STATUS_COMMAND } });

  const other = folder('settings-other');
  fs.writeFileSync(path.join(other, 'settings.json'), '{"theme": "dark"}');
  ensureStatusLine(other);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(other, 'settings.json'), 'utf8')), {
    theme: 'dark',
    statusLine: { type: 'command', command: STATUS_COMMAND },
  });
});

test('a status line the member already has, or a settings file that is not valid JSON, is left alone', () => {
  for (const [name, text] of [['own', '{"statusLine": {"type": "command", "command": "mine.sh"}}'], ['broken', '{ not json']]) {
    const dir = folder(`settings-${name}`);
    fs.writeFileSync(path.join(dir, 'settings.json'), text);
    ensureStatusLine(dir);
    assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), text);
  }
});

test('the usage line of a stream-json run reads as rate limits in percent', () => {
  const line = JSON.stringify({
    type: 'rate_limit_event',
    rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.83, resetsAt: 100 }, seven_day: { utilization: 0.72, resetsAt: 200 } } },
  });
  const limits = rateLimitsFrom(line)!;
  assert.equal(Math.round(limits.five_hour!.used_percentage), 83);
  assert.equal(limits.seven_day!.resets_at, 200);
  assert.equal(rateLimitsFrom('{"type":"result"}'), null);
  assert.equal(rateLimitsFrom('not json'), null);
});

test('the usage probe sends one Haiku message that is saved nowhere and loads no settings, hooks or MCP servers', async () => {
  const log = path.join(root, 'probe.log');
  process.env.FAKE_CLAUDE_LOG = log;
  process.env.FAKE_CLAUDE_FIVE = '61';
  const dir = folder('probe');
  const limits = await probeRateLimits(dir);
  delete process.env.FAKE_CLAUDE_LOG;
  delete process.env.FAKE_CLAUDE_FIVE;
  assert.equal(Math.round(limits!.five_hour!.used_percentage), 61);
  assert.equal(Math.round(limits!.seven_day!.used_percentage), 40);
  const [call] = readLog(log);
  assert.equal(call.dir, dir);
  for (const flag of ['-p', '--model', 'haiku', '--no-session-persistence', '--setting-sources', '--strict-mcp-config']) assert.ok(call.args.includes(flag), flag);
  writeQuota(dir, { rate_limits: limits });
  assert.deepEqual(readQuota(dir), { fiveHour: 61, week: 40 });
});

test('a probe that gets no usage line gives nothing back', async () => {
  process.env.FAKE_CLAUDE_NO_LIMITS = '1';
  assert.equal(await probeRateLimits(folder('probe-none')), null);
  delete process.env.FAKE_CLAUDE_NO_LIMITS;
});

test('quota-axi\'s JSON is read as used percent and Unix reset times, and only a fresh reading counts', () => {
  const report = (status: string) =>
    JSON.stringify({
      providers: [
        {
          provider: 'claude',
          windows: [
            { id: 'five_hour', percentRemaining: 82, resetsAt: '2026-03-15T20:10:48.000Z' },
            { id: 'seven_day', percentRemaining: 64, resetsAt: '2026-03-20T17:59:45.600Z' },
            { id: 'model:fable', percentRemaining: 71, resetsAt: '2026-03-20T08:25:12.000Z' },
          ],
          state: { status },
        },
      ],
    });
  assert.deepEqual(rateLimitsFromQuotaAxi(report('fresh')), {
    five_hour: { used_percentage: 18, resets_at: Date.UTC(2026, 2, 15, 20, 10, 48) / 1000 },
    seven_day: { used_percentage: 36, resets_at: Math.floor(Date.UTC(2026, 2, 20, 17, 59, 45) / 1000) },
  });
  assert.equal(rateLimitsFromQuotaAxi(report('stale')), null);
  assert.equal(rateLimitsFromQuotaAxi(report('error')), null);
  assert.equal(rateLimitsFromQuotaAxi('not json'), null);
});

test('the quota-axi read runs once in the member folder, without QUOTA_AXI_CLAUDE_PROFILES, and sends no message', async () => {
  const log = path.join(root, 'quota-axi.log');
  const claudeLog = path.join(root, 'quota-axi-claude.log');
  Object.assign(process.env, { FAKE_QUOTA_LOG: log, FAKE_CLAUDE_LOG: claudeLog, FAKE_QUOTA_FIVE: '12', QUOTA_AXI_CLAUDE_PROFILES: 'a;b' });
  const dir = folder('quota-axi');
  const limits = await readRateLimits(dir);
  for (const name of ['FAKE_QUOTA_LOG', 'FAKE_CLAUDE_LOG', 'FAKE_QUOTA_FIVE', 'QUOTA_AXI_CLAUDE_PROFILES']) delete process.env[name];
  assert.deepEqual(limits, { five_hour: { used_percentage: 12, resets_at: 2000000000 }, seven_day: { used_percentage: 55, resets_at: 2000604800 } });
  assert.deepEqual(JSON.parse(fs.readFileSync(log, 'utf8')), { args: ['--provider', 'claude', '--json'], dir, profiles: null });
  assert.equal(fs.existsSync(claudeLog), false);
});

test('a quota-axi read that fails or is not fresh gives nothing back', async () => {
  process.env.FAKE_QUOTA_STATUS = 'stale';
  assert.equal(await readRateLimits(folder('quota-axi-stale')), null);
  delete process.env.FAKE_QUOTA_STATUS;
  process.env.FAKE_QUOTA_EXIT = '1';
  assert.equal(await readRateLimits(folder('quota-axi-fail')), null);
  delete process.env.FAKE_QUOTA_EXIT;
});

test('crew statusline saves the reading into CLAUDE_CONFIG_DIR and prints one line', () => {
  const dir = folder('cli');
  const run = spawnSync(process.execPath, [cliPath, 'statusline'], {
    input: JSON.stringify(payload(12, 34)),
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir, NO_COLOR: '1' },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0);
  assert.match(run.stdout.trim(), /^Opus 5 \| 5h:12% \| 7d:34% \| ↻ \d\d:\d\d \(\d+(h\d\d)?m\) \| crew cli$/);
  assert.equal(quotaOf(dir).seven_day_pct, 34);
});

test('crew statusline with no payload still prints and exits 0', () => {
  const run = spawnSync(process.execPath, [cliPath, 'statusline'], { input: 'not json', env: { ...process.env, CLAUDE_CONFIG_DIR: folder('junk'), NO_COLOR: '1' }, encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), 'crew junk');
});
