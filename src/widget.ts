import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configFile, crewHome, packageRoot } from './paths.js';

export const widgetScript = path.join(packageRoot, 'widget', 'crewrota-widget.pyw');

function pidFile(): string {
  return path.join(crewHome(), 'widget.pid');
}

function closeFile(): string {
  return path.join(crewHome(), 'widget.close');
}

// The widget writes its pid when it starts and removes it when it quits.
export function widgetPid(): number | null {
  try {
    const pid = Number(fs.readFileSync(pidFile(), 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

// pythonw on Windows, so no console window opens with the widget.
export function findPython(): string | null {
  if (process.env.CREWROTA_PYTHON) return process.env.CREWROTA_PYTHON;
  const names = process.platform === 'win32' ? ['pythonw', 'pyw'] : ['python3'];
  for (const name of names) {
    try {
      const out = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const first = out.split(/\r?\n/).find((line) => line.trim());
      if (first) return first.trim();
    } catch {
      // not on PATH
    }
  }
  return null;
}

function pythonOrThrow(): string {
  const python = findPython();
  if (!python) throw new Error('The widget needs Python 3 with Tk (the python.org installer includes both). Install it, then try again.');
  return python;
}

function widgetArgs(): string[] {
  return [widgetScript, '--home', crewHome(), '--config', configFile(), '--node', process.execPath, '--cli', path.join(packageRoot, 'dist', 'cli.js')];
}

export function openWidget(): 'opened' | 'already' {
  if (widgetPid()) return 'already';
  const python = pythonOrThrow();
  fs.mkdirSync(crewHome(), { recursive: true });
  fs.rmSync(closeFile(), { force: true });
  spawn(python, widgetArgs(), { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return 'opened';
}

export async function closeWidget(waitMs = 5000): Promise<'closed' | 'not-open' | 'still-open'> {
  if (!widgetPid()) return 'not-open';
  fs.writeFileSync(closeFile(), '');
  for (let waited = 0; waited < waitMs; waited += 250) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!widgetPid()) return 'closed';
  }
  return 'still-open';
}

export function startupShortcut(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'crewrota widget.lnk');
}

export function startupIsOn(): boolean {
  return process.platform === 'win32' && fs.existsSync(startupShortcut());
}

// The values go in through the environment, so no path needs quoting inside the PowerShell command.
export function setStartup(on: boolean): string {
  if (process.platform !== 'win32') throw new Error('Opening the widget at login is Windows-only for now; macOS gets a menu bar item later.');
  const link = startupShortcut();
  if (!on) {
    fs.rmSync(link, { force: true });
    return link;
  }
  const python = pythonOrThrow();
  fs.mkdirSync(path.dirname(link), { recursive: true });
  const command = '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:CREW_LINK); $s.TargetPath = $env:CREW_TARGET; $s.Arguments = $env:CREW_ARGS; $s.WorkingDirectory = $env:CREW_HOME; $s.Description = "crewrota widget"; $s.Save()';
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, CREW_LINK: link, CREW_TARGET: python, CREW_ARGS: widgetArgs().map((arg) => `"${arg}"`).join(' '), CREW_HOME: crewHome() },
    stdio: 'ignore',
  });
  if (!fs.existsSync(link)) throw new Error(`Could not create ${link}`);
  return link;
}
