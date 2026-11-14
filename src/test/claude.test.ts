import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { type RunResult, type Runner, authStatus, claude, claudeCommand, claudeVersion, memberEnv, probeRateLimits, quotaAxiCommand, rateLimitsFrom, rateLimitsFromQuotaAxi, readRateLimits, runSync, startClaude } from '../claude.js';
import { fakeClaude, isolate, onPlatform, readLog } from './helpers.js';

const root = isolate();
const QUOTA_ARGS = ['--provider', 'claude', '--json'];
const usageLine = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: 100 } } } });
const quotaJson = JSON.stringify({ providers: [{ windows: [{ id: 'five_hour', percentRemaining: 75, resetsAt: '2033-05-18T03:33:20.000Z' }], state: { status: 'fresh' } }] });
let scripts = 0;

// Writes a stand-in program for this test; it only exists under the temp root.
function script(body: string): string {
  const file = path.join(root, `stand-in-${scripts++}.mjs`);
  fs.writeFileSync(file, `import fs from 'node:fs';\n${body}\n`);
  return file;
}

async function withEnv<T>(values: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  const assign = (from: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(from)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  assign(values);
  try {
    return await fn();
  } finally {
    assign(saved);
  }
}

const hanging = 'setTimeout(() => {}, 60_000);';

// Answers as asked and records each call; nothing is ever started.
function runner(answer: (command: string, args: string[]) => Partial<RunResult>) {
  const calls: { command: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  const run: Runner = (command, args, env) => {
    calls.push({ command, args, env });
    return { status: 0, stdout: '', stderr: '', ...answer(command, args) };
  };
  return { run, calls };
}

const notFound = () => Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException;

async function gone(pid: number): Promise<boolean> {
  for (let n = 0; n < 200; n++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test('runSync gives back the exit code and both streams, with the env it is given', () => {
  const result = runSync(process.execPath, ['-e', 'console.log(process.env.SEEN); console.error("to stderr"); process.exit(3)'], { ...process.env, SEEN: 'yes' });
  assert.equal(result.status, 3);
  assert.equal(result.stdout.trim(), 'yes');
  assert.equal(result.stderr.trim(), 'to stderr');
  assert.equal(result.error, undefined);
});

test('runSync reports a program that cannot start without throwing', () => {
  const result = runSync(path.join(root, 'no-such-program'), []);
  assert.equal(result.status, null);
  assert.equal(result.stdout, '');
  assert.equal(result.error?.code, 'ENOENT');
});

test('claudeCommand runs a script override with node, another override directly, and plain claude otherwise', async () => {
  for (const file of ['fake.js', 'fake.mjs', 'fake.cjs']) {
    await withEnv({ CREWROTA_CLAUDE: file }, () => assert.deepEqual(claudeCommand(), [process.execPath, [file]]));
  }
  await withEnv({ CREWROTA_CLAUDE: 'fake.exe' }, () => assert.deepEqual(claudeCommand(), ['fake.exe', []]));
  await withEnv({ CREWROTA_CLAUDE: undefined, PATH: root }, () => assert.deepEqual(claudeCommand(), ['claude', []]));
  await withEnv({ CREWROTA_CLAUDE: '', PATH: root }, () => assert.deepEqual(claudeCommand(), ['claude', []]));
});

// A PATH folder holding what an install left there: file name to content.
function pathFolder(files: Record<string, string>): string {
  const dir = path.join(root, `path-${scripts++}`);
  fs.mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

const exeShim = '@ECHO off\r\nGOTO start\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';
const nodeShim = 'IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n';

test('on Windows claudeCommand runs the program an npm claude.cmd shim points at, with node for a script', async () => {
  const exeDir = pathFolder({ 'claude.cmd': exeShim });
  const nodeDir = pathFolder({ 'claude.cmd': nodeShim });
  const pnpmDir = pathFolder({ 'claude.cmd': '@SETLOCAL\r\n"%~dp0\\global\\node_modules\\claude\\bin\\claude.exe" %*\r\n' });
  await withEnv({ CREWROTA_CLAUDE: undefined }, async () => {
    await withEnv({ PATH: exeDir }, () => assert.deepEqual(onPlatform('win32', () => claudeCommand()), [path.join(exeDir, 'node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'), []]));
    await withEnv({ PATH: nodeDir }, () => assert.deepEqual(onPlatform('win32', () => claudeCommand()), [process.execPath, [path.join(nodeDir, 'node_modules\\@anthropic-ai\\claude-code\\cli.js')]]));
    await withEnv({ PATH: pnpmDir }, () => assert.deepEqual(onPlatform('win32', () => claudeCommand()), [path.join(pnpmDir, 'global\\node_modules\\claude\\bin\\claude.exe'), []]));
    await withEnv({ PATH: exeDir }, () => assert.deepEqual(onPlatform('linux', () => claudeCommand()), ['claude', []]));
  });
});

test('on Windows the first PATH folder with claude wins, a claude.exe there is left to spawn, and a shim with no target gives plain claude', async () => {
  const exeDir = pathFolder({ 'claude.exe': '', 'claude.cmd': exeShim });
  const shimDir = pathFolder({ 'claude.cmd': exeShim });
  const oddDir = pathFolder({ 'claude.cmd': '@echo off\r\nclaude-real %*\r\n' });
  await withEnv({ CREWROTA_CLAUDE: undefined }, async () => {
    await withEnv({ PATH: [root, exeDir, shimDir].join(path.delimiter) }, () => assert.deepEqual(onPlatform('win32', () => claudeCommand()), ['claude', []]));
    await withEnv({ PATH: [shimDir, exeDir].join(path.delimiter) }, () => assert.equal(onPlatform('win32', () => claudeCommand())[0], path.join(shimDir, 'node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe')));
    await withEnv({ PATH: oddDir }, () => assert.deepEqual(onPlatform('win32', () => claudeCommand()), ['claude', []]));
  });
});

test('CREWROTA_CLAUDE wins over a claude.cmd shim on PATH', async () => {
  await withEnv({ CREWROTA_CLAUDE: 'fake.exe', PATH: pathFolder({ 'claude.cmd': exeShim }) }, () => assert.deepEqual(onPlatform('win32', () => claudeCommand()), ['fake.exe', []]));
});

test('quotaAxiCommand runs a script override with node and another override directly, always with the same arguments', async () => {
  for (const file of ['fake.js', 'fake.mjs', 'fake.cjs']) {
    await withEnv({ CREWROTA_QUOTA_AXI: file }, () => assert.deepEqual(quotaAxiCommand(), [process.execPath, [file, ...QUOTA_ARGS]]));
  }
  await withEnv({ CREWROTA_QUOTA_AXI: 'fake.exe' }, () => assert.deepEqual(quotaAxiCommand(), ['fake.exe', QUOTA_ARGS]));
});

test('memberEnv sets the config folder on a copy of the environment', () => {
  const env = memberEnv('some-dir');
  assert.equal(env.CLAUDE_CONFIG_DIR, 'some-dir');
  assert.equal(env.HOME, process.env.HOME);
  assert.equal(process.env.CLAUDE_CONFIG_DIR, undefined);
});

test('claude passes its arguments after the command prefix, and the env through', () => {
  const { run, calls } = runner(() => ({ stdout: 'done' }));
  const env = { MARK: '1' };
  assert.equal(claude(['auth', 'logout'], env, run).stdout, 'done');
  assert.deepEqual(calls, [{ command: process.execPath, args: [fakeClaude, 'auth', 'logout'], env }]);
});

test('claudeVersion trims the version, and any failure gives null', () => {
  assert.equal(claudeVersion(runner(() => ({ stdout: ' 2.1.310 (Claude Code)\n' })).run), '2.1.310 (Claude Code)');
  assert.equal(claudeVersion(runner(() => ({ status: 1, stdout: 'broken' })).run), null);
  assert.equal(claudeVersion(runner(() => ({ status: null, error: notFound() })).run), null);
});

test('claudeVersion, authStatus and every other call start the same program for a claude.cmd shim on Windows, never cmd.exe', async () => {
  const dir = pathFolder({ 'claude.cmd': exeShim });
  const target = path.join(dir, 'node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe');
  await withEnv({ CREWROTA_CLAUDE: undefined, PATH: dir }, () => {
    const { run, calls } = runner((_, args) => ({ stdout: args[0] === '--version' ? '2.1.325 (Claude Code)\n' : '{"loggedIn":true}' }));
    assert.equal(onPlatform('win32', () => claudeVersion(run)), '2.1.325 (Claude Code)');
    assert.equal(onPlatform('win32', () => authStatus('d', run)).loggedIn, true);
    assert.deepEqual(calls.map((call) => call.command), [target, target]);
  });
});

test('authStatus asks about the member folder and reads the answer', () => {
  const { run, calls } = runner(() => ({ status: 0, stdout: JSON.stringify({ loggedIn: true, configDirectory: 'the-dir' }) }));
  assert.deepEqual(authStatus('the-dir', run), { code: 0, loggedIn: true, configDirectory: 'the-dir' });
  assert.deepEqual(calls[0].args.slice(-3), ['auth', 'status', '--json']);
  assert.equal(calls[0].env?.CLAUDE_CONFIG_DIR, 'the-dir');
});

test('authStatus counts only a real true as logged in, and keeps the exit code', () => {
  for (const loggedIn of ['true', 1, null]) {
    assert.equal(authStatus('d', runner(() => ({ status: 0, stdout: JSON.stringify({ loggedIn }) })).run).loggedIn, false);
  }
  assert.equal(authStatus('d', runner(() => ({ status: 4, stdout: '{"loggedIn":false}' })).run).code, 4);
});

test('authStatus turns a failure to start or an answer that is not JSON into a problem', () => {
  assert.deepEqual(authStatus('d', runner(() => ({ status: null, error: notFound() })).run), { code: null, loggedIn: false, problem: 'could not run claude: spawn claude ENOENT' });
  assert.deepEqual(authStatus('d', runner(() => ({ status: 2, stdout: 'plain', stderr: ' why\n' })).run), { code: 2, loggedIn: false, problem: 'claude auth status did not return JSON: why' });
  assert.match(authStatus('d', runner(() => ({ status: 2, stdout: 'plain' })).run).problem!, /did not return JSON: plain$/);
  assert.match(authStatus('d', runner(() => ({ stdout: 'null' })).run).problem!, /did not return JSON/);
});

test('rateLimitsFrom keeps a zero, keeps one window alone, and skips a window with no number', () => {
  const line = (unifiedWindows: unknown) => JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows } });
  assert.deepEqual(rateLimitsFrom(line({ five_hour: { utilization: 0, resetsAt: 9 } })), { five_hour: { used_percentage: 0, resets_at: 9 } });
  assert.deepEqual(rateLimitsFrom(line({ five_hour: { utilization: 'high' }, seven_day: { utilization: 0.5, resetsAt: 9 } })), { seven_day: { used_percentage: 50, resets_at: 9 } });
  assert.equal(rateLimitsFrom(line({ five_hour: null, other: { utilization: 0.5 } })), null);
  assert.equal(rateLimitsFrom(line({})), null);
  assert.equal(rateLimitsFrom('{"type":"rate_limit_event"}'), null);
  assert.equal(rateLimitsFrom('null'), null);
});

test('rateLimitsFromQuotaAxi reads what is there and turns away a report with nothing usable', () => {
  const report = (windows: unknown, status = 'fresh') => JSON.stringify({ providers: [{ windows, state: { status } }] });
  assert.deepEqual(rateLimitsFromQuotaAxi(report([{ id: 'five_hour', percentRemaining: 100 }])), { five_hour: { used_percentage: 0, resets_at: 0 } });
  assert.deepEqual(rateLimitsFromQuotaAxi(report([null, { id: 'seven_day', percentRemaining: 40, resetsAt: 'not a date' }])), { seven_day: { used_percentage: 60, resets_at: 0 } });
  assert.equal(rateLimitsFromQuotaAxi(report([{ id: 'five_hour', percentRemaining: 'most' }])), null);
  assert.equal(rateLimitsFromQuotaAxi(report([])), null);
  assert.equal(rateLimitsFromQuotaAxi(report('not a list')), null);
  assert.equal(rateLimitsFromQuotaAxi('{"providers":[]}'), null);
  assert.equal(rateLimitsFromQuotaAxi('null'), null);
});

test('the probe puts a usage line back together when it arrives in two pieces', async () => {
  const half = Math.floor(usageLine.length / 2);
  const file = script(`process.stdout.write(${JSON.stringify(usageLine.slice(0, half))}); setTimeout(() => process.stdout.write(${JSON.stringify(usageLine.slice(half) + '\n')}), 200);`);
  await withEnv({ CREWROTA_CLAUDE: file }, async () => {
    assert.deepEqual(await probeRateLimits(root), { five_hour: { used_percentage: 50, resets_at: 100 } });
  });
});

test('the probe stops the run as soon as it has the usage line', async () => {
  const pidFile = path.join(root, 'probe.pid');
  const file = script(`fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); console.log(${JSON.stringify(usageLine)}); ${hanging}`);
  await withEnv({ CREWROTA_CLAUDE: file }, async () => {
    assert.deepEqual(await probeRateLimits(root), { five_hour: { used_percentage: 50, resets_at: 100 } });
  });
  assert.equal(await gone(Number(fs.readFileSync(pidFile, 'utf8'))), true);
});

test('the probe and the quota-axi read give up after their timeout and stop the program', async () => {
  const pidFile = path.join(root, 'timeout.pid');
  const file = script(`fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); ${hanging}`);
  await withEnv({ CREWROTA_CLAUDE: file, CREWROTA_QUOTA_AXI: file }, async () => {
    for (const read of [probeRateLimits, readRateLimits]) {
      fs.rmSync(pidFile, { force: true });
      const started = Date.now();
      assert.equal(await read(root, 4_000), null);
      assert.ok(Date.now() - started >= 3_900);
      const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8')) : 0; // 0 when a busy machine had not started it yet
      if (pid) assert.equal(await gone(pid), true);
    }
  });
});

test('the probe and the quota-axi read give nothing back when the program cannot start', async () => {
  const missing = path.join(root, 'no-such-program');
  await withEnv({ CREWROTA_CLAUDE: missing, CREWROTA_QUOTA_AXI: missing }, async () => {
    assert.equal(await probeRateLimits(root), null);
    assert.equal(await readRateLimits(root), null);
  });
});

test('the probe and the quota-axi read run in the temp folder, never in the user\'s project', async () => {
  const seen = path.join(root, 'cwd.txt');
  const file = script(`fs.writeFileSync(${JSON.stringify(seen)}, process.cwd());`);
  await withEnv({ CREWROTA_CLAUDE: file, CREWROTA_QUOTA_AXI: file }, async () => {
    for (const read of [probeRateLimits, readRateLimits]) {
      fs.rmSync(seen, { force: true });
      await read(root);
      assert.equal(fs.realpathSync.native(fs.readFileSync(seen, 'utf8')), fs.realpathSync.native(os.tmpdir()));
    }
  });
});

test('the quota-axi read joins output that arrives in pieces', async () => {
  const half = Math.floor(quotaJson.length / 2);
  const file = script(`process.stdout.write(${JSON.stringify(quotaJson.slice(0, half))}); setTimeout(() => process.stdout.write(${JSON.stringify(quotaJson.slice(half))}), 200);`);
  await withEnv({ CREWROTA_QUOTA_AXI: file }, async () => {
    assert.deepEqual(await readRateLimits(root), { five_hour: { used_percentage: 25, resets_at: Date.UTC(2033, 4, 18, 3, 33, 20) / 1000 } });
  });
});

test('startClaude runs in the member folder, passes the extra env, and returns the exit code', async () => {
  const log = path.join(root, 'start.log');
  const seen = path.join(root, 'start-env.txt');
  const file = script(`fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ args: process.argv.slice(2), dir: process.env.CLAUDE_CONFIG_DIR, extra: process.env.EXTRA })); process.exit(7);`);
  const before = process.listenerCount('SIGINT');
  let duringRun = -1;
  let spawned = 0;
  const code = await withEnv({ CREWROTA_CLAUDE: file, FAKE_CLAUDE_LOG: log }, () =>
    startClaude(['--resume'], 'member-dir', () => {
      spawned++;
      duringRun = process.listenerCount('SIGINT');
    }, { EXTRA: 'on' }),
  );
  assert.equal(code, 7);
  assert.equal(spawned, 1);
  assert.equal(duringRun, before + 1);
  assert.equal(process.listenerCount('SIGINT'), before);
  assert.deepEqual(JSON.parse(fs.readFileSync(seen, 'utf8')), { args: ['--resume'], dir: 'member-dir', extra: 'on' });
  assert.deepEqual(readLog(log), []);
});

test('startClaude returns 1 for a run stopped by a signal', async () => {
  const file = script('process.kill(process.pid, "SIGTERM"); setTimeout(() => {}, 60_000);');
  assert.equal(await withEnv({ CREWROTA_CLAUDE: file }, () => startClaude([], root)), 1);
});

test('startClaude that cannot start says so, returns 1, and stops ignoring Ctrl+C', async () => {
  const before = process.listenerCount('SIGINT');
  const errors = mock.method(console, 'error', () => {});
  let spawned = false;
  try {
    const code = await withEnv({ CREWROTA_CLAUDE: path.join(root, 'no-such-program') }, () => startClaude([], root, () => (spawned = true)));
    assert.equal(code, 1);
    assert.equal(spawned, false);
    assert.match(String(errors.mock.calls[0].arguments[0]), /^crewrota: could not start claude: /);
  } finally {
    errors.mock.restore();
  }
  assert.equal(process.listenerCount('SIGINT'), before);
});
