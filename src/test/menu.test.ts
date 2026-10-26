import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { CANCEL_SYMBOL } from '@clack/prompts';
import type { Config } from '../config.js';
import { ADD_MEMBER, TYPE_A_NAME, askMemberName, askSkipPermissions, crewMenu, menubarColour, menubarLines, pickChoice, pickMember, quotaLines } from '../menu.js';
import { memberDir } from '../paths.js';
import { fakeMember, isolate, scriptedUi } from './helpers.js';

isolate();

const config: Config = { skipPermissions: null, lastModel: 'sonnet', lastEffort: 'low', current: 'work', members: {} };
fakeMember(config, 'work', { ship: 'team' });
fakeMember(config, 'home');
config.members.work.model = 'opus';
config.members.work.effort = 'max';
fs.writeFileSync(path.join(memberDir('work'), 'quota.json'), JSON.stringify({ ts: Math.floor(Date.now() / 1000) - 600, five_hour_pct: 42.4, seven_day_pct: 18 }));

test('with no members the menu offers to add the first one', async () => {
  const { ui, asked } = scriptedUi([ADD_MEMBER]);
  assert.equal(await pickMember({ skipPermissions: null, members: {} }, ui), ADD_MEMBER);
  assert.deepEqual(asked[0].options, [{ value: ADD_MEMBER, label: 'Add your first crew member' }]);
});

test('the member list marks the current one, shows ship and usage, preselects it and ends with the add item', async () => {
  const { ui, asked } = scriptedUi(['work']);
  assert.equal(await pickMember(config, ui), 'work');
  const labels = asked[0].options!.map((option) => option.label);
  assert.deepEqual(labels, [
    '   home  isolated  no reading yet',
    '*  work  team      5h 42%  7d 18%  (10 min ago)',
    '+ Add a crew member',
  ]);
  assert.equal(asked[0].initialValue, 'work');
});

test('a new member name is checked as it is typed', async () => {
  const { ui, asked } = scriptedUi([' fresh ']);
  assert.equal(await askMemberName(config, ui), 'fresh');
  const validate = (asked[0] as unknown as { validate: (value: string) => string | undefined }).validate;
  assert.match(validate('Work')!, /lowercase letters/);
  assert.match(validate('work')!, /already exists/);
  assert.equal(validate('fresh'), undefined);
});

test('the menu pre-selects the member\'s last model and effort', async () => {
  const { ui, asked } = scriptedUi(['opus', 'max']);
  assert.deepEqual(await pickChoice(config, 'work', ui), { model: 'opus', effort: 'max' });
  assert.deepEqual(asked.map((item) => item.initialValue), ['opus', 'max']);
});

test('a member with no history starts from the last choice on any member', async () => {
  const { ui, asked } = scriptedUi(['sonnet', 'low']);
  await pickChoice(config, 'home', ui);
  assert.deepEqual(asked.map((item) => item.initialValue), ['sonnet', 'low']);
});

test('a typed model name is used as given', async () => {
  const { ui } = scriptedUi(['(type a name)', ' claude-opus-5-5 ', 'high']);
  assert.deepEqual(await pickChoice(config, 'home', ui), { model: 'claude-opus-5-5', effort: 'high' });
});

test('Ctrl+C at any menu step returns nothing', async () => {
  assert.equal(await pickMember(config, scriptedUi([CANCEL_SYMBOL]).ui), null);
  for (const answers of [[CANCEL_SYMBOL], ['(type a name)', CANCEL_SYMBOL], ['opus', CANCEL_SYMBOL]]) {
    assert.equal(await pickChoice(config, 'work', scriptedUi(answers).ui), null);
  }
});

const UP = '\x1b[A';
const DOWN = '\x1b[B';
const RIGHT = '\x1b[C';
const LEFT = '\x1b[D';
const ENTER = '\r';
const ESC = '\x1b';

// Types the keys into the one-screen menu and returns its answer and the last screen it drew, without escape codes.
async function drive(keys: string[]) {
  const input = new PassThrough();
  const output = new PassThrough();
  let drawn = '';
  output.on('data', (chunk) => (drawn += chunk.toString()));
  const answer = crewMenu(config, { input, output });
  for (const key of keys) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    input.write(key);
  }
  const result = await answer;
  return { result, screen: drawn.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '') };
}

test('the one-screen menu starts on the current member with its remembered ship, model and effort', async () => {
  const { result, screen } = await drive([ENTER]);
  assert.deepEqual(result, { member: 'work', choice: { model: 'opus', effort: 'max' }, ship: 'team' });
  assert.match(screen, /crewrota {2}pick a crew member/);
  assert.match(screen, /› {2}work +▖{6}▖{8} +42% +▖{3}▖{11} +18%/);
  assert.match(screen, /home +no reading yet/);
  assert.match(screen, /\+ Add a crew member/);
  assert.match(screen, /ship +‹ team ›/);
  assert.match(screen, /model +‹ opus ›/);
  assert.match(screen, /effort +‹ max ›/);
  assert.match(screen, /↑↓ move {3}←→ ship, model, effort {3}enter start {3}esc quit/);
});

test("moving to another member brings back that member's remembered choice and ship", async () => {
  const { result } = await drive([UP, ENTER]);
  assert.deepEqual(result, { member: 'home', choice: { model: 'sonnet', effort: 'low' }, ship: 'isolated' });
});

test('left and right change ship, model and effort; enter starts from any row', async () => {
  const { result } = await drive([DOWN, DOWN, LEFT, DOWN, RIGHT, DOWN, LEFT, ENTER]);
  assert.deepEqual(result, { member: 'work', choice: { model: 'sonnet', effort: 'xhigh' }, ship: 'isolated' });
});

test('the model can be set to "type a name", which the caller then asks for', async () => {
  const { result, screen } = await drive([DOWN, DOWN, DOWN, RIGHT, RIGHT, ENTER]);
  assert.deepEqual(result, { member: 'work', choice: { model: TYPE_A_NAME, effort: 'max' }, ship: 'team' });
  assert.match(screen, /model +‹ type a name ›/);
});

test('enter on the add row asks to add a member; esc closes the menu', async () => {
  assert.equal((await drive([DOWN, ENTER])).result, ADD_MEMBER);
  assert.equal((await drive([ESC])).result, null);
});

test('crew quota lists every member with its bars and no marker', () => {
  const lines = quotaLines(config, new PassThrough());
  assert.equal(lines[0], 'crewrota  crew quota');
  assert.match(lines[2], /member +5h +week/);
  assert.match(lines[3], /^ {5}home +no reading yet$/);
  assert.match(lines[4], /^ {5}work +▖{14} +42% +▖{14} +18%$/);
});

test('crew quota --format menubar puts the current member in the bar text, then every member and two actions', () => {
  const lines = menubarLines(config);
  assert.deepEqual(lines.slice(0, 7), ['crew 42%', '---', 'home', 'no reading yet', 'work | font=Helvetica-Bold', '5h 42% | color=#3fb68b', 'week 18% | color=#3fb68b']);
  assert.equal(lines[7], '---');
  assert.match(lines[8], /^Open the crew menu \| shell=".+" param1=".+cli\.js" terminal=true$/);
  assert.equal(lines[9], 'Refresh | refresh=true');
  assert.equal(lines.length, 10);
});

test('the menu bar shows reset times and colours each window with the widget\'s rule', () => {
  const now = Date.now();
  const others: Config = { skipPermissions: null, members: {} };
  fakeMember(others, 'mac');
  const at = (seconds: number) => Math.floor(now / 1000) + seconds;
  fs.writeFileSync(path.join(memberDir('mac'), 'quota.json'), JSON.stringify({ ts: at(-60), five_hour_pct: 71, seven_day_pct: 92, five_hour_resets_at: at(3600), seven_day_resets_at: at(3 * 86400) }));
  const lines = menubarLines(others, now);
  assert.equal(lines[0], 'crew');
  assert.equal(lines[2], 'mac');
  assert.match(lines[3], /^5h 71% {2}resets \d\d:\d\d \| color=#e0a43a$/);
  assert.match(lines[4], /^week 92% {2}resets (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d \| color=#e5534b$/);
  assert.deepEqual([59, 60, 79, 80].map(menubarColour), ['#3fb68b', '#e0a43a', '#e0a43a', '#e5534b']);
  assert.deepEqual(menubarLines({ skipPermissions: null, members: {} }).slice(0, 3), ['crew', '---', 'No crew members yet']);
});

test('the skip-permissions question defaults to no and reports a cancel as null', async () => {
  const { ui, asked } = scriptedUi([CANCEL_SYMBOL]);
  assert.equal(await askSkipPermissions(ui), null);
  assert.equal(asked[0].initialValue, false);
});
