import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import { memberDir } from '../paths.js';
import { type MemberRow, formatRows, memberRows, readQuota, readResets, readUsage } from '../rows.js';
import { fakeMember, isolate } from './helpers.js';

const root = isolate();
const NOW = 1_800_000_000_000;
const NOW_SECONDS = NOW / 1000;
let folders = 0;

function quotaFolder(content?: string | object): string {
  const dir = path.join(root, `quota-${folders++}`);
  fs.mkdirSync(dir);
  if (content !== undefined) fs.writeFileSync(path.join(dir, 'quota.json'), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
}

const noReading = ['', 'not json', 'null', '[]', '{"five_hour_pct": 5}', '{"ts": "yesterday"}'];

test('a missing or broken quota.json, or one with no number for ts, reads as no reading', () => {
  assert.equal(readUsage(quotaFolder(), NOW), 'no reading yet');
  assert.equal(readQuota(quotaFolder(), NOW), null);
  for (const content of noReading) {
    const dir = quotaFolder(content);
    assert.equal(readUsage(dir, NOW), 'no reading yet', content);
    assert.equal(readQuota(dir, NOW), null, content);
  }
});

test('the age of a reading steps up at each boundary', () => {
  const ages: [number, string][] = [
    [0, 'just now'],
    [59, 'just now'],
    [60, '1 min ago'],
    [3599, '59 min ago'],
    [3600, '1 h ago'],
    [86399, '23 h ago'],
    [86400, '1 d ago'],
    [172800, '2 d ago'],
  ];
  for (const [seconds, text] of ages) {
    assert.equal(readUsage(quotaFolder({ ts: NOW_SECONDS - seconds, five_hour_pct: 1, seven_day_pct: 2 }), NOW), `5h 1%  7d 2%  (${text})`);
  }
});

test('a reading stamped in the future reads as just now', () => {
  assert.match(readUsage(quotaFolder({ ts: NOW_SECONDS + 500 }), NOW), /\(just now\)$/);
});

test('usage rounds a percent, reads a numeric string, and shows a dash for anything else', () => {
  assert.match(readUsage(quotaFolder({ ts: NOW_SECONDS, five_hour_pct: 42.5, seven_day_pct: '7' }), NOW), /^5h 43% {2}7d 7% /);
  for (const value of ['', null, undefined, 'lots']) {
    assert.match(readUsage(quotaFolder({ ts: NOW_SECONDS, five_hour_pct: value, seven_day_pct: value }), NOW), /^5h - {2}7d - /);
  }
});

test('quota reads a missing percent as null, keeps a zero, and rounds', () => {
  assert.deepEqual(readQuota(quotaFolder({ ts: NOW_SECONDS, five_hour_pct: 0, seven_day_pct: 12.4 }), NOW), { fiveHour: 0, week: 12, fable: null });
  for (const value of ['', null, 'lots']) {
    assert.deepEqual(readQuota(quotaFolder({ ts: NOW_SECONDS, five_hour_pct: value }), NOW), { fiveHour: null, week: null, fable: null });
  }
});

test('quota counts a window as 0 only once its reset has passed, and each window on its own', () => {
  const reading = (fiveAt: unknown, weekAt: unknown) => quotaFolder({ ts: NOW_SECONDS, five_hour_pct: 80, seven_day_pct: 60, five_hour_resets_at: fiveAt, seven_day_resets_at: weekAt });
  assert.deepEqual(readQuota(reading(NOW_SECONDS - 1, NOW_SECONDS + 1), NOW), { fiveHour: 0, week: 60, fable: null });
  assert.deepEqual(readQuota(reading(NOW_SECONDS, NOW_SECONDS - 1), NOW), { fiveHour: 80, week: 0, fable: null });
});

test('quota ignores a reset time that is zero or not a number', () => {
  for (const at of [0, -5, 'soon', null]) {
    assert.deepEqual(readQuota(quotaFolder({ ts: NOW_SECONDS, five_hour_pct: 80, five_hour_resets_at: at }), NOW), { fiveHour: 80, week: null, fable: null });
  }
});

test('a window with no percent stays null even after its reset', () => {
  assert.deepEqual(readQuota(quotaFolder({ ts: NOW_SECONDS, five_hour_resets_at: 1 }), NOW), { fiveHour: null, week: null, fable: null });
});

test('readResets keeps only the reset times still ahead', () => {
  const dir = quotaFolder({ five_hour_resets_at: NOW_SECONDS + 1, seven_day_resets_at: NOW_SECONDS });
  assert.deepEqual(readResets(dir, NOW), { fiveHour: NOW_SECONDS + 1, week: null });
  assert.deepEqual(readResets(dir, NOW + 2000), { fiveHour: null, week: null });
  assert.deepEqual(readResets(quotaFolder({ five_hour_resets_at: 'soon' }), NOW), { fiveHour: null, week: null });
});

test('readResets does not need a ts, and a missing or broken file gives nulls', () => {
  assert.deepEqual(readResets(quotaFolder({ seven_day_resets_at: NOW_SECONDS + 9 }), NOW), { fiveHour: null, week: NOW_SECONDS + 9 });
  assert.deepEqual(readResets(quotaFolder(), NOW), { fiveHour: null, week: null });
  for (const content of ['not json', 'null']) assert.deepEqual(readResets(quotaFolder(content), NOW), { fiveHour: null, week: null });
});

test('memberRows sorts by name and reads each member\'s folder', () => {
  const config = loadConfig();
  fakeMember(config, 'zed', { ship: 'team', email: 'z@example.com', org: 'Acme' });
  fakeMember(config, 'amy');
  config.current = 'zed';
  fs.writeFileSync(path.join(memberDir('zed'), 'quota.json'), JSON.stringify({ ts: NOW_SECONDS, five_hour_pct: 10, seven_day_pct: 20 }));

  assert.deepEqual(memberRows(config, NOW), [
    { name: 'amy', current: false, ship: 'isolated', usage: 'no reading yet', quota: null, identity: 'amy@example.com (personal)' },
    { name: 'zed', current: true, ship: 'team', usage: '5h 10%  7d 20%  (just now)', quota: { fiveHour: 10, week: 20, fable: null }, identity: 'z@example.com (Acme)' },
  ]);
});

test('memberRows copes with a member whose folder is gone', () => {
  const config = loadConfig();
  config.members.lost = { provider: 'claude', created: '2026-10-25T00:00:00.000Z' };
  assert.deepEqual(memberRows(config, NOW), [{ name: 'lost', current: false, ship: 'isolated', usage: 'no reading yet', quota: null, identity: 'no login found' }]);
});

const row = (name: string, ship: string, usage: string, identity = '', current = false): MemberRow => ({ name, current, ship, usage, quota: null, identity });

test('formatRows gives nothing for no rows', () => {
  assert.deepEqual(formatRows([]), []);
});

test('formatRows without identity leaves no padding after the usage, even for a member that has one', () => {
  assert.deepEqual(formatRows([row('a', 'isolated', 'short', 'a@example.com'), row('bbb', 's', 'a longer usage')]), ['   a    isolated  short', '   bbb  s         a longer usage']);
});

test('formatRows with identity lines the identities up and a row with none has no trailing spaces', () => {
  assert.deepEqual(formatRows([row('a', 's', 'short', 'a@example.com'), row('b', 's', 'a longer usage')], true), ['   a  s  short           a@example.com', '   b  s  a longer usage']);
});

test('formatRows tints each cell and pads by the text, not the colour codes', () => {
  const tint = (tone: string, text: string, bold = false) => `<${tone}${bold ? '!' : ''}>${text}</>`;
  assert.deepEqual(formatRows([row('a', 's', 'use', 'me', true), row('bb', 'ss', 'use')], true, tint), ['<green>*</>  <text!>a </>  <faint>s </>  use  <faint>me</>', '   <text!>bb</>  <faint>ss</>  use']);
});
