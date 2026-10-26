import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';

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

// Runs claude in the member's folder with the terminal handed over to it.
export function startClaude(args: string[], dir: string, onSpawn: () => void = () => {}): Promise<number> {
  const [command, prefix] = claudeCommand();
  return new Promise((resolve) => {
    const child = spawn(command, [...prefix, ...args], { stdio: 'inherit', env: memberEnv(dir) });
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
