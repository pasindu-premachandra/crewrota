import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
}

export type Runner = (command: string, args: string[], env?: NodeJS.ProcessEnv) => RunResult;

export const runSync: Runner = (command, args, env) => {
  const result = spawnSync(command, args, { encoding: 'utf8', env: env ?? process.env });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
};

// CREWROTA_CLAUDE points crewrota at another claude, such as the fake one the tests use.
export function claudeCommand(): [string, string[]] {
  const override = process.env.CREWROTA_CLAUDE;
  if (!override) return ['claude', []];
  if (/\.[cm]?js$/.test(override)) return [process.execPath, [override]];
  return [override, []];
}

export function memberEnv(dir: string): NodeJS.ProcessEnv {
  return { ...process.env, CLAUDE_CONFIG_DIR: dir };
}

export function claude(args: string[], env?: NodeJS.ProcessEnv, run: Runner = runSync): RunResult {
  const [command, prefix] = claudeCommand();
  return run(command, [...prefix, ...args], env);
}

export function claudeVersion(run: Runner = runSync): string | null {
  let result = claude(['--version'], undefined, run);
  // An npm-installed claude on Windows is a .cmd shim, which only cmd.exe can start.
  if (result.error?.code === 'ENOENT' && process.platform === 'win32' && !process.env.CREWROTA_CLAUDE) {
    result = run('cmd.exe', ['/d', '/c', 'claude --version']);
  }
  return !result.error && result.status === 0 ? result.stdout.trim() : null;
}

export interface AuthStatus {
  code: number | null;
  loggedIn: boolean;
  configDirectory?: string;
  problem?: string;
}

export function authStatus(dir: string, run: Runner = runSync): AuthStatus {
  const result = claude(['auth', 'status', '--json'], memberEnv(dir), run);
  if (result.error) return { code: null, loggedIn: false, problem: `could not run claude: ${result.error.message}` };
  try {
    const data = JSON.parse(result.stdout);
    return { code: result.status, loggedIn: data.loggedIn === true, configDirectory: data.configDirectory };
  } catch {
    return { code: result.status, loggedIn: false, problem: `claude auth status did not return JSON: ${(result.stderr || result.stdout).trim()}` };
  }
}

export interface RateLimits {
  five_hour?: { used_percentage: number; resets_at: number };
  seven_day?: { used_percentage: number; resets_at: number };
}

// Reads the usage line of a stream-json run, in the shape the status line gets as rate_limits.
export function rateLimitsFrom(line: string): RateLimits | null {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (event?.type !== 'rate_limit_event') return null;
  const windows = event.rate_limit_info?.unifiedWindows ?? {};
  const limits: RateLimits = {};
  for (const name of ['five_hour', 'seven_day'] as const) {
    const window = windows[name];
    if (typeof window?.utilization === 'number') limits[name] = { used_percentage: window.utilization * 100, resets_at: window.resetsAt };
  }
  return Object.keys(limits).length > 0 ? limits : null;
}

// Sends one tiny Haiku message as the member and reads only the usage Claude Code reports back.
// The run is saved nowhere and loads none of the member's settings, hooks or MCP servers.
export function probeRateLimits(dir: string, timeoutMs = 30_000): Promise<RateLimits | null> {
  const [command, prefix] = claudeCommand();
  const args = [
    ...prefix,
    '-p', 'ok',
    '--model', 'haiku',
    '--output-format', 'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--disable-slash-commands',
  ];
  return new Promise((resolve) => {
    let done = false;
    let buffer = '';
    const child = spawn(command, args, { cwd: os.tmpdir(), env: memberEnv(dir), stdio: ['ignore', 'pipe', 'ignore'] });
    const finish = (limits: RateLimits | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill(); // the usage line comes before the reply, so the rest is not needed
      resolve(limits);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    child.stdout.on('data', (chunk) => {
      const lines = (buffer + chunk).split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const limits = rateLimitsFrom(line);
        if (limits) return finish(limits);
      }
    });
    child.on('error', () => finish(null));
    child.on('exit', () => finish(null));
  });
}

const QUOTA_AXI_ARGS = ['--provider', 'claude', '--json'];

// The quota-axi crewrota ships with; its exports hide package.json, so walk up from its entry point.
export function quotaAxiBin(): string {
  let dir = path.dirname(createRequire(import.meta.url).resolve('quota-axi'));
  while (!fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
  const bin = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).bin['quota-axi'];
  return path.join(dir, bin);
}

// CREWROTA_QUOTA_AXI points crewrota at another quota-axi, such as the fake one the tests use.
// Started with node, not npx: npx checks the registry and starts npm on every call (about 2.4 s per menu open).
export function quotaAxiCommand(): [string, string[]] {
  const override = process.env.CREWROTA_QUOTA_AXI;
  if (override) return /\.[cm]?js$/.test(override) ? [process.execPath, [override, ...QUOTA_AXI_ARGS]] : [override, QUOTA_AXI_ARGS];
  return [process.execPath, [quotaAxiBin(), ...QUOTA_AXI_ARGS]];
}

// Reads quota-axi's JSON in the shape the status line gets as rate_limits; only a fresh reading counts.
export function rateLimitsFromQuotaAxi(text: string): RateLimits | null {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const provider = data?.providers?.[0];
  if (provider?.state?.status !== 'fresh' || !Array.isArray(provider.windows)) return null;
  const limits: RateLimits = {};
  for (const window of provider.windows) {
    if ((window?.id === 'five_hour' || window?.id === 'seven_day') && typeof window.percentRemaining === 'number') {
      limits[window.id as keyof RateLimits] = { used_percentage: 100 - window.percentRemaining, resets_at: Math.floor(Date.parse(window.resetsAt) / 1000) || 0 };
    }
  }
  return Object.keys(limits).length > 0 ? limits : null;
}

// Reads one member's usage with quota-axi, which sends no message. One call per member with CLAUDE_CONFIG_DIR:
// several folders in QUOTA_AXI_CLAUDE_PROFILES read idle members as credentials_expired.
export function readRateLimits(dir: string, timeoutMs = 30_000): Promise<RateLimits | null> {
  const [command, args] = quotaAxiCommand();
  const env = memberEnv(dir);
  delete env.QUOTA_AXI_CLAUDE_PROFILES;
  return new Promise((resolve) => {
    let done = false;
    let output = '';
    const child = spawn(command, args, { cwd: os.tmpdir(), env, stdio: ['ignore', 'pipe', 'ignore'] });
    const finish = (limits: RateLimits | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(limits);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', () => finish(null));
    child.on('close', () => finish(rateLimitsFromQuotaAxi(output)));
  });
}

// Runs claude in the member's folder with the terminal handed over to it.
export function startClaude(args: string[], dir: string, onSpawn: () => void = () => {}, extraEnv: NodeJS.ProcessEnv = {}): Promise<number> {
  const [command, prefix] = claudeCommand();
  return new Promise((resolve) => {
    const child = spawn(command, [...prefix, ...args], { stdio: 'inherit', env: { ...memberEnv(dir), ...extraEnv } });
    const ignoreInterrupt = () => {}; // Ctrl+C belongs to Claude while it runs
    process.on('SIGINT', ignoreInterrupt);
    child.on('spawn', onSpawn);
    child.on('error', (error) => {
      process.off('SIGINT', ignoreInterrupt);
      console.error(`crewrota: could not start claude: ${error.message}`);
      resolve(1);
    });
    child.on('exit', (code) => {
      process.off('SIGINT', ignoreInterrupt);
      resolve(code ?? 1);
    });
  });
}
