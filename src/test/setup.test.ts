import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, saveConfig } from '../config.js';
import { mainClaudeDir } from '../paths.js';
import { PLAYWRIGHT_MCP, type SetupDeps, type SetupRunner, runSetup, toolChecks, treehouseStep } from '../setup.js';
import { createShip, readShipMcp, shipMcpFile, writeShipMcp } from '../ships.js';
import { isolate } from './helpers.js';

isolate();

const SKILL_LINES = [
  'npx skills add kunchenguid/lavish-axi --skill lavish -g',
  'npx skills add kunchenguid/gh-axi --skill gh-axi -g',
  'npx skills add kunchenguid/quota-axi --skill quota-axi -g',
];
const DEFAULT_LINES = [...SKILL_LINES, treehouseStep().line, 'npm install -g @playwright/cli@latest', 'playwright-cli install --skills'];

// Stands in for every command crew setup runs: PATH probes, gh auth status and installs. Nothing real is run.
function fakeRunner(options: { onPath?: string[]; fail?: string[]; ghSignedIn?: boolean } = {}) {
  const installs: { line: string; cwd?: string; show?: boolean }[] = [];
  const result = (status: number) => ({ status, stdout: '', stderr: '' });
  const run: SetupRunner = (command, args, opts) => {
    const line = command === 'where.exe' ? `command -v ${args[0]}` : args[args.length - 1];
    const probe = /^command -v (\S+)$/.exec(line);
    if (probe) return result(options.onPath?.includes(probe[1]) ? 0 : 1);
    if (line === 'gh auth status') return result(options.ghSignedIn ? 0 : 1);
    installs.push({ line, cwd: opts.cwd, show: opts.show });
    return result(options.fail?.includes(line) ? 1 : 0);
  };
  return { run, installs };
}

function deps(run: SetupRunner, interactive: boolean, answers: (boolean | null)[] = []) {
  const printed: string[] = [];
  const asked: string[] = [];
  const value: SetupDeps = {
    run,
    interactive,
    ask: async (message) => {
      asked.push(message);
      return answers.shift() ?? null;
    },
    print: (line) => printed.push(line.replace(/\x1b\[[0-9;]*m/g, '')),
  };
  return { value, printed, asked };
}

function reset() {
  fs.rmSync(path.join(mainClaudeDir()), { recursive: true, force: true });
  fs.rmSync(process.env.CREWROTA_HOME!, { recursive: true, force: true });
  saveConfig({ skipPermissions: null, members: {} });
}

test('--yes on a fresh machine runs every default install in order and adds playwright to the ships that lack it', async () => {
  reset();
  createShip('team');
  createShip('solo');
  writeShipMcp('solo', { playwright: { type: 'stdio', command: 'npx', args: ['custom'] }, other: { type: 'http', url: 'https://example.com/mcp' } });
  const before = fs.readFileSync(shipMcpFile('solo'), 'utf8');
  const { run, installs } = fakeRunner({ onPath: ['gh'], ghSignedIn: false });
  const d = deps(run, false);

  assert.equal(await runSetup({ yes: true, withHooks: false }, d.value), 0);
  assert.deepEqual(installs.map((call) => call.line), DEFAULT_LINES);
  assert.ok(installs.every((call) => call.show), 'installs get the terminal');
  assert.equal(installs.find((call) => call.line === 'playwright-cli install --skills')!.cwd, os.homedir());
  assert.deepEqual(readShipMcp('team'), { playwright: PLAYWRIGHT_MCP });
  assert.equal(fs.readFileSync(shipMcpFile('solo'), 'utf8'), before);
  assert.deepEqual(d.asked, []);
  const out = d.printed.join('\n');
  assert.match(out, /runs: npx skills add kunchenguid\/lavish-axi --skill lavish -g\n\s+lands in: ~\/\.claude\/skills\/lavish/);
  assert.match(out, /Lavish telemetry was not asked/);
  assert.match(out, /gh is not signed in\. Next: gh auth login \(run it yourself; crewrota never runs it\)/);
  assert.doesNotMatch(out, /gh-axi setup hooks|--with-hooks/);
  assert.equal(loadConfig().lavishTelemetry, undefined);
});

test('anything already installed is skipped and never updated in place', async () => {
  reset();
  for (const name of ['lavish', 'gh-axi', 'quota-axi']) fs.mkdirSync(path.join(mainClaudeDir(), 'skills', name), { recursive: true });
  createShip('team');
  writeShipMcp('team', { playwright: PLAYWRIGHT_MCP });
  const config = loadConfig();
  config.lavishTelemetry = true;
  saveConfig(config);
  const { run, installs } = fakeRunner({ onPath: ['treehouse', 'playwright-cli', 'gh'], ghSignedIn: true });
  const d = deps(run, false);

  assert.equal(await runSetup({ yes: false, withHooks: false }, d.value), 0);
  assert.deepEqual(installs, []);
  assert.deepEqual(d.asked, []);
  const out = d.printed.join('\n');
  assert.equal(out.match(/already installed, skipped/g)?.length, 6);
  assert.match(out, /Everything is installed already\. Nothing to do\./);
  assert.match(out, /\[OK\] gh is signed in/);
});

test('without a terminal and without --yes it lists what it would run, then refuses with the hint', async () => {
  reset();
  const { run, installs } = fakeRunner();
  const d = deps(run, false);
  await assert.rejects(runSetup({ yes: false, withHooks: false }, d.value), /needs a terminal\. Run it in a terminal, or pass --yes to install without asking\./);
  assert.deepEqual(installs, []);
  assert.match(d.printed.join('\n'), /npx skills add kunchenguid\/quota-axi --skill quota-axi -g/);
});

test('in a terminal it asks once; a no installs nothing', async () => {
  reset();
  const { run, installs } = fakeRunner();
  const d = deps(run, true, [false]);
  assert.equal(await runSetup({ yes: false, withHooks: false }, d.value), 0);
  assert.deepEqual(d.asked, ['Install the 5 items above?'], 'no ships yet, so no playwright MCP entry to add');
  assert.deepEqual(installs, []);
  assert.match(d.printed.join('\n'), /Nothing installed\./);
});

test('a yes installs, then the telemetry question: a no is saved as lavishTelemetry false', async () => {
  reset();
  const { run, installs } = fakeRunner();
  const d = deps(run, true, [true, false]);
  assert.equal(await runSetup({ yes: false, withHooks: false }, d.value), 0);
  assert.equal(d.asked.length, 2);
  assert.match(d.asked[1], /telemetry/);
  assert.deepEqual(installs.map((call) => call.line), DEFAULT_LINES);
  assert.equal(loadConfig().lavishTelemetry, false);
  assert.match(d.printed.join('\n'), /Lavish telemetry: off \(launches pass LAVISH_AXI_TELEMETRY=0\)/);
  assert.match(d.printed.join('\n'), /gh is not installed; gh-axi needs it/);

  const again = deps(fakeRunner().run, true, [false]);
  await runSetup({ yes: false, withHooks: false }, again.value);
  assert.equal(again.asked.length, 1, 'telemetry is asked once, ever');
});

test('--with-hooks also installs gh-axi and lavish-axi and runs both setup hooks commands', async () => {
  reset();
  const { run, installs } = fakeRunner();
  assert.equal(await runSetup({ yes: true, withHooks: true }, deps(run, false).value), 0);
  assert.deepEqual(installs.map((call) => call.line).slice(DEFAULT_LINES.length), ['npm install -g gh-axi lavish-axi', 'gh-axi setup hooks', 'lavish-axi setup hooks']);

  reset();
  fs.mkdirSync(mainClaudeDir(), { recursive: true });
  const hooks = { SessionStart: [{ hooks: [{ type: 'command', command: 'gh-axi hook' }, { type: 'command', command: 'lavish-axi hook' }] }] };
  fs.writeFileSync(path.join(mainClaudeDir(), 'settings.json'), JSON.stringify({ hooks }));
  const second = fakeRunner({ onPath: ['gh-axi', 'lavish-axi'] });
  await runSetup({ yes: true, withHooks: true }, deps(second.run, false).value);
  assert.deepEqual(second.installs.map((call) => call.line), DEFAULT_LINES);
});

test('a failed step stops the rest of that tool, the others still run, and the exit code is 1', async () => {
  reset();
  const { run, installs } = fakeRunner({ fail: ['npm install -g @playwright/cli@latest', SKILL_LINES[0]] });
  const d = deps(run, false);
  assert.equal(await runSetup({ yes: true, withHooks: false }, d.value), 1);
  assert.deepEqual(installs.map((call) => call.line), DEFAULT_LINES.filter((line) => line !== 'playwright-cli install --skills'));
  assert.match(d.printed.join('\n'), /\[!\] playwright-cli: npm install -g @playwright\/cli@latest did not finish/);
});

test('treehouse installs with PowerShell on Windows and curl elsewhere', () => {
  assert.deepEqual(treehouseStep('win32'), { line: 'irm https://kunchenguid.github.io/treehouse/install.ps1 | iex', powershell: true });
  assert.deepEqual(treehouseStep('darwin'), { line: 'curl -fsSL https://kunchenguid.github.io/treehouse/install.sh | sh' });
});

test('doctor tool lines: one per tool, installed or missing with the exact command, never failing the doctor', () => {
  reset();
  fs.mkdirSync(path.join(mainClaudeDir(), 'skills', 'lavish'), { recursive: true });
  createShip('team');
  const checks = toolChecks(fakeRunner({ onPath: ['treehouse', 'gh'], ghSignedIn: true }).run);
  assert.ok(checks.every((check) => check.optional));
  assert.deepEqual(checks.map((check) => check.detail), [
    'lavish skill: installed',
    'gh-axi skill: missing',
    'quota-axi skill: missing',
    'treehouse: installed',
    'playwright-cli: missing',
    'playwright MCP: missing',
    'gh-axi and lavish-axi commands (opt-in): missing',
    'gh-axi session hook (opt-in): missing',
    'lavish-axi session hook (opt-in): missing',
    'gh sign-in: gh is signed in',
    'Lavish telemetry: not asked yet',
  ]);
  const fix = (name: string) => checks.find((check) => check.detail.startsWith(name))!.fix;
  assert.equal(fix('gh-axi skill'), 'npx skills add kunchenguid/gh-axi --skill gh-axi -g (or: crew setup)');
  assert.equal(fix('playwright-cli'), 'npm install -g @playwright/cli@latest, then playwright-cli install --skills (or: crew setup)');
  assert.equal(fix('gh-axi session hook'), 'gh-axi setup hooks (or: crew setup --with-hooks)');
  assert.match(fix('playwright MCP')!, /^crew setup/);
});
