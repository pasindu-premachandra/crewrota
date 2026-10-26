import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RunResult } from './claude.js';
import { type Config, loadConfig, saveConfig } from './config.js';
import type { Check } from './doctor.js';
import { lstatOrNull } from './links.js';
import { mainClaudeDir } from './paths.js';
import { say } from './say.js';
import { listShips, readShipMcp, shipMcpFile, writeShipMcp } from './ships.js';

// show hands the terminal to the command (installs); without it the output is captured (checks).
export type SetupRunner = (command: string, args: string[], options: { show?: boolean; cwd?: string }) => RunResult;

export const realSetupRunner: SetupRunner = (command, args, options) => {
  const result = spawnSync(command, args, { encoding: 'utf8', cwd: options.cwd, stdio: options.show ? 'inherit' : 'pipe' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
};

interface Step {
  line: string;
  powershell?: boolean;
  cwd?: string;
}

export interface Tool {
  name: string;
  steps: Step[];
  lands: string;
  installed: boolean;
  optIn?: boolean;
  apply?: () => void; // a tool that edits files instead of running commands
}

export const PLAYWRIGHT_MCP = { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] };

// Commands run through the shell, so npm's .cmd shims start on Windows too.
function shell(step: Step): [string, string[]] {
  if (step.powershell) return ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', step.line]];
  return process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', step.line]] : ['sh', ['-c', step.line]];
}

function onPath(name: string, run: SetupRunner): boolean {
  const result = process.platform === 'win32' ? run('where.exe', [name], {}) : run('sh', ['-c', `command -v ${name}`], {});
  return !result.error && result.status === 0;
}

function hasSkill(name: string): boolean {
  return lstatOrNull(path.join(mainClaudeDir(), 'skills', name)) !== null;
}

// The upstream setup hooks commands write a SessionStart hook into Claude Code's user settings.
function hasHook(name: string): boolean {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(mainClaudeDir(), 'settings.json'), 'utf8'));
    return JSON.stringify(settings.hooks ?? {}).includes(name);
  } catch {
    return false;
  }
}

// Read only: a ship without its own mcp.json counts as missing the entry.
function shipsWithoutPlaywright(config: Config): string[] {
  return listShips(config).filter((ship) => {
    try {
      return !JSON.parse(fs.readFileSync(shipMcpFile(ship), 'utf8'))?.mcpServers?.playwright;
    } catch {
      return true;
    }
  });
}

function skill(name: string, repo: string): Tool {
  return {
    name: `${name} skill`,
    steps: [{ line: `npx skills add kunchenguid/${repo} --skill ${name} -g` }],
    lands: `~/.claude/skills/${name}`,
    installed: hasSkill(name),
  };
}

export function treehouseStep(platform = process.platform): Step {
  return platform === 'win32'
    ? { line: 'irm https://kunchenguid.github.io/treehouse/install.ps1 | iex', powershell: true }
    : { line: 'curl -fsSL https://kunchenguid.github.io/treehouse/install.sh | sh' };
}

export function setupTools(config: Config, run: SetupRunner, withHooks = true): Tool[] {
  const ships = shipsWithoutPlaywright(config);
  const tools: Tool[] = [
    skill('lavish', 'lavish-axi'),
    skill('gh-axi', 'gh-axi'),
    skill('quota-axi', 'quota-axi'),
    { name: 'treehouse', steps: [treehouseStep()], lands: 'the treehouse command on your PATH (its installer picks the folder)', installed: onPath('treehouse', run) },
    {
      name: 'playwright-cli',
      steps: [{ line: 'npm install -g @playwright/cli@latest' }, { line: 'playwright-cli install --skills', cwd: os.homedir() }],
      lands: 'the playwright-cli command (global npm), its skill installed from your home folder into ~/.claude/skills',
      installed: onPath('playwright-cli', run),
    },
    {
      name: 'playwright MCP',
      steps: [],
      lands: ships.length > 0 ? ships.map(shipMcpFile).join(', ') : 'every ship has it (or there are no ships yet)',
      installed: ships.length === 0,
      apply: () => {
        for (const ship of ships) {
          const servers = readShipMcp(ship);
          if (!servers.playwright) writeShipMcp(ship, { ...servers, playwright: PLAYWRIGHT_MCP });
        }
      },
    },
  ];
  if (withHooks) {
    tools.push(
      {
        name: 'gh-axi and lavish-axi commands',
        steps: [{ line: 'npm install -g gh-axi lavish-axi' }],
        lands: 'global npm packages',
        installed: onPath('gh-axi', run) && onPath('lavish-axi', run),
        optIn: true,
      },
      { name: 'gh-axi session hook', steps: [{ line: 'gh-axi setup hooks' }], lands: 'a SessionStart hook in ~/.claude/settings.json', installed: hasHook('gh-axi'), optIn: true },
      { name: 'lavish-axi session hook', steps: [{ line: 'lavish-axi setup hooks' }], lands: 'a SessionStart hook in ~/.claude/settings.json', installed: hasHook('lavish-axi'), optIn: true },
    );
  }
  return tools;
}

function action(tool: Tool): string {
  if (tool.apply) return `adds playwright (${PLAYWRIGHT_MCP.command} ${PLAYWRIGHT_MCP.args.join(' ')}) to each ship's mcp.json that has none`;
  return tool.steps.map((step) => step.line).join(', then ');
}

function ghSignIn(run: SetupRunner): { ok: boolean; detail: string; fix: string } {
  if (!onPath('gh', run)) return { ok: false, detail: 'gh is not installed; gh-axi needs it', fix: 'Install gh from https://cli.github.com, then: gh auth login' };
  const result = run(...shell({ line: 'gh auth status' }), {});
  const fix = 'gh auth login (run it yourself; crewrota never runs it)';
  return result.status === 0 ? { ok: true, detail: 'gh is signed in', fix } : { ok: false, detail: 'gh is not signed in', fix };
}

function telemetryState(config: Config): string {
  return config.lavishTelemetry === undefined ? 'not asked yet' : config.lavishTelemetry ? 'on' : 'off (launches pass LAVISH_AXI_TELEMETRY=0)';
}

export interface SetupDeps {
  run: SetupRunner;
  ask: (message: string, initialValue: boolean) => Promise<boolean | null>;
  interactive: boolean;
  print: (line: string) => void;
}

export async function runSetup(options: { yes: boolean; withHooks: boolean }, deps: SetupDeps): Promise<number> {
  const { run, print } = deps;
  const config = loadConfig();
  const tools = setupTools(config, run, options.withHooks);
  const todo = tools.filter((tool) => !tool.installed);
  const askTelemetry = config.lavishTelemetry === undefined && deps.interactive && !options.yes;

  print('crew setup installs these from upstream. Anything already installed is skipped and never updated.');
  print('');
  for (const tool of tools) {
    print(`  ${tool.name}${tool.optIn ? ' (--with-hooks)' : ''}`);
    print(`      ${tool.installed ? 'already installed, skipped' : `runs: ${action(tool)}`}`);
    if (!tool.installed) print(`      lands in: ${tool.lands}`);
  }
  print('  gh sign-in');
  print('      checked with gh auth status after the installs, only reported; crewrota never runs gh auth login');
  print('  Lavish telemetry');
  print(`      ${config.lavishTelemetry === undefined ? 'asked after the installs (a no turns it off for every launch)' : telemetryState(config)}`);
  print('');

  if (todo.length > 0 && !options.yes) {
    if (!deps.interactive) throw new Error('crew setup asks once before it installs anything, and that needs a terminal. Run it in a terminal, or pass --yes to install without asking.');
    const answer = await deps.ask(`Install the ${todo.length} item${todo.length === 1 ? '' : 's'} above?`, true);
    if (!answer) {
      print('Nothing installed.');
      return 0;
    }
  }

  let failed = 0;
  for (const tool of todo) {
    if (tool.apply) {
      tool.apply();
      print(say('ok', `${tool.name}: added to ${tool.lands}`));
      continue;
    }
    const broken = tool.steps.find((step) => {
      const result = run(...shell(step), { show: true, cwd: step.cwd });
      return result.error || result.status !== 0;
    });
    if (broken) {
      failed++;
      print(say('warn', `${tool.name}: ${broken.line} did not finish. Run it yourself to see why.`));
    } else {
      print(say('ok', tool.name));
    }
  }
  if (todo.length === 0) print('Everything is installed already. Nothing to do.');

  if (askTelemetry) {
    const answer = await deps.ask('Let lavish-axi send its usage telemetry? (No sets LAVISH_AXI_TELEMETRY=0 for every launch)', true);
    if (answer !== null) {
      config.lavishTelemetry = answer;
      saveConfig(config);
    }
  } else if (config.lavishTelemetry === undefined) {
    print(say('info', 'Lavish telemetry was not asked: that needs a terminal and no --yes. Run crew setup in a terminal to answer it.'));
  }
  print(`Lavish telemetry: ${telemetryState(config)}`);

  const gh = ghSignIn(run);
  print(gh.ok ? say('ok', gh.detail) : say('warn', `${gh.detail}. Next: ${gh.fix}`));
  return failed > 0 ? 1 : 0;
}

// One line per tool for crew doctor; missing tools never fail the doctor.
export function toolChecks(run: SetupRunner = realSetupRunner): Check[] {
  const config = loadConfig();
  const checks: Check[] = setupTools(config, run).map((tool) => ({
    name: 'tool',
    ok: tool.installed,
    optional: true,
    detail: `${tool.name}${tool.optIn ? ' (opt-in)' : ''}: ${tool.installed ? 'installed' : 'missing'}`,
    fix: tool.apply ? `crew setup (${action(tool)})` : `${action(tool)}${tool.optIn ? ' (or: crew setup --with-hooks)' : ' (or: crew setup)'}`,
  }));
  const gh = ghSignIn(run);
  checks.push({ name: 'tool', ok: gh.ok, optional: true, detail: `gh sign-in: ${gh.detail}`, fix: gh.fix });
  checks.push({ name: 'tool', ok: true, optional: true, detail: `Lavish telemetry: ${telemetryState(config)}` });
  return checks;
}
