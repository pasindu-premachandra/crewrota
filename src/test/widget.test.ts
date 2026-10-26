import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { crewHome } from '../paths.js';
import { startupShortcut } from '../widget.js';
import { cliPath, isolate } from './helpers.js';

isolate();

function cli(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

// Stands in for the Python widget: writes widget.pid, quits when widget.close appears.
const FAKE_WIDGET = `
const fs = require('fs'), path = require('path');
const home = process.env.CREWROTA_HOME;
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(path.join(home, 'widget.pid'), String(process.pid));
const timer = setInterval(() => {
  if (!fs.existsSync(path.join(home, 'widget.close'))) return;
  fs.rmSync(path.join(home, 'widget.close'));
  fs.rmSync(path.join(home, 'widget.pid'));
  clearInterval(timer);
}, 100);
`;

test('crew widget close says so when no widget is open', () => {
  const { code, out } = cli(['widget', 'close']);
  assert.equal(code, 0);
  assert.match(out, /The widget is not open\./);
});

test('crew widget does not open a second one while one is running', () => {
  fs.mkdirSync(crewHome(), { recursive: true });
  fs.writeFileSync(path.join(crewHome(), 'widget.pid'), String(process.pid));
  const { code, out } = cli(['widget'], { CREWROTA_PYTHON: path.join(crewHome(), 'no-such-python') });
  assert.equal(code, 0);
  assert.match(out, /already open/);
  fs.rmSync(path.join(crewHome(), 'widget.pid'));
});

test('crew widget close asks the running widget to quit and waits for it', async () => {
  const fake = spawn(process.execPath, ['-e', FAKE_WIDGET], { stdio: 'ignore' });
  const pidFile = path.join(crewHome(), 'widget.pid');
  for (let i = 0; i < 50 && !fs.existsSync(pidFile); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  const { code, out } = cli(['widget', 'close']);
  assert.equal(code, 0);
  assert.match(out, /Closed the widget\./);
  assert.equal(fs.existsSync(pidFile), false);
  fake.kill();
});

test('crew widget startup on makes a login shortcut and off removes it', { skip: process.platform !== 'win32' }, () => {
  const on = cli(['widget', 'startup', 'on'], { CREWROTA_PYTHON: process.execPath });
  assert.equal(on.code, 0, on.err);
  assert.ok(fs.existsSync(startupShortcut()));
  const off = cli(['widget', 'startup', 'off']);
  assert.equal(off.code, 0);
  assert.equal(fs.existsSync(startupShortcut()), false);
});

test('crew widget with an unknown action prints its usage', () => {
  const { code, err } = cli(['widget', 'open', 'now']);
  assert.equal(code, 1);
  assert.match(err, /Usage: crew widget/);
});
