import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Config, type Shortcut, saveConfig } from './config.js';
import { memberOrThrow } from './members.js';
import { checkName } from './names.js';
import { crewHome } from './paths.js';

export type LinkRunner = (env: Record<string, string>) => void;
export type Starter = (command: string, args: string[]) => void;

const HOTKEY = /^((CTRL|ALT|SHIFT)\+)+([A-Z0-9]|F([1-9]|1[0-2]))$/;

export function shortcutsDir(): string {
  return path.join(crewHome(), 'shortcuts');
}

export function workspaceFile(name: string): string {
  return path.join(shortcutsDir(), `${name}.code-workspace`);
}

export function launcherFile(name: string): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${name}.lnk`);
}

// Code.exe on Windows (the bin folder's parent holds it); the code CLI elsewhere.
export function findCode(): string | null {
  if (process.env.CREWROTA_CODE) return process.env.CREWROTA_CODE;
  if (process.platform === 'win32') {
    const places = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'), process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe')];
    const found = places.find((place) => place && fs.existsSync(place));
    if (found) return found;
  }
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['code'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).find((line) => line.trim())?.trim();
    if (!first) return null;
    if (process.platform !== 'win32') return first;
    const exe = path.join(path.dirname(path.dirname(first)), 'Code.exe');
    return fs.existsSync(exe) ? exe : null;
  } catch {
    return null; // not on PATH
  }
}

// Git Bash on Windows (Claude Code needs Git for Windows there), the login shell elsewhere.
export function findShell(): string | null {
  if (process.platform !== 'win32') return process.env.SHELL || '/bin/sh';
  const places = [process.env.CLAUDE_CODE_GIT_BASH_PATH, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe')];
  try {
    const out = execFileSync('where.exe', ['git'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const git = out.split(/\r?\n/).find((line) => line.trim())?.trim();
    if (git) places.splice(1, 0, path.join(path.dirname(path.dirname(git)), 'bin', 'bash.exe')); // <Git>\cmd\git.exe sits next to <Git>\bin
  } catch {
    // git not on PATH
  }
  const found = places.find((place) => place && fs.existsSync(place));
  return found ? found.replace(/\\/g, '/') : null;
}

function codeOrThrow(): string {
  const code = findCode();
  if (!code) throw new Error('VS Code was not found. Install it from https://code.visualstudio.com, then try again.');
  return code;
}

export function parseHotkey(keys: string): string {
  const hotkey = keys.toUpperCase();
  if (!HOTKEY.test(hotkey)) throw new Error(`"${keys}" is not a hotkey. Use CTRL, ALT or SHIFT joined by +, then a letter, digit or F1 to F12, such as CTRL+ALT+C.`);
  return hotkey;
}

export function parseFolder(folder: string): string {
  if (!fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${folder} is not a folder`);
  return path.resolve(folder).replace(/\\/g, '/');
}

export function workspace(shortcut: Shortcut, shell = findShell()): unknown {
  const crew = `crew ${shortcut.member}`;
  // the shell takes over when the session ends, so the tab stays usable
  const run = shell ? { type: 'process', command: shell, args: ['-l', '-i', '-c', `${crew}; exec "${shell}" -l -i`] } : { type: 'shell', command: crew };
  return {
    folders: [{ path: shortcut.folder }],
    settings: { 'terminal.integrated.defaultLocation': 'editor' },
    tasks: {
      version: '2.0.0',
      tasks: [
        {
          label: crew,
          ...run,
          options: { cwd: shortcut.folder },
          runOptions: { runOn: 'folderOpen' },
          presentation: { reveal: 'always', panel: 'dedicated', focus: true },
          problemMatcher: [],
        },
      ],
    },
  };
}

// The values go in through the environment, so no path needs quoting inside the PowerShell command.
export const writeLink: LinkRunner = (env) => {
  const command = '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:CREW_LINK); $s.TargetPath = $env:CREW_TARGET; $s.Arguments = $env:CREW_ARGS; $s.WorkingDirectory = $env:CREW_FOLDER; $s.Description = $env:CREW_DESCRIPTION; if ($env:CREW_HOTKEY) { $s.Hotkey = $env:CREW_HOTKEY }; $s.Save()';
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { env: { ...process.env, ...env }, stdio: 'ignore' });
};

// The workspace file everywhere; the Start Menu entry on Windows.
export function writeShortcut(shortcut: Shortcut, run: LinkRunner = writeLink): void {
  const code = process.platform === 'win32' ? codeOrThrow() : null;
  fs.mkdirSync(shortcutsDir(), { recursive: true });
  fs.writeFileSync(workspaceFile(shortcut.name), JSON.stringify(workspace(shortcut), null, 2) + '\n');
  if (!code) return;
  const link = launcherFile(shortcut.name);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { force: true }); // a fresh file, so a dropped hotkey does not stay behind
  run({
    CREW_LINK: link,
    CREW_TARGET: code,
    CREW_ARGS: `"${workspaceFile(shortcut.name)}"`,
    CREW_FOLDER: shortcut.folder,
    CREW_DESCRIPTION: `crew ${shortcut.member}`,
    CREW_HOTKEY: shortcut.hotkey ?? '',
  });
  if (!fs.existsSync(link)) throw new Error(`Could not create ${link}`);
}

function deleteFiles(name: string): void {
  fs.rmSync(workspaceFile(name), { force: true });
  fs.rmSync(launcherFile(name), { force: true });
}

export function shortcutOrThrow(config: Config, name: string): Shortcut {
  checkName('shortcut', name);
  const shortcut = config.shortcuts?.find((entry) => entry.name === name);
  if (!shortcut) throw new Error(`Shortcut ${name} doesn't exist. Add it with: crew shortcut add ${name} --member <m> --folder <path>`);
  return shortcut;
}

export function memberShortcuts(config: Config, member: string): Shortcut[] {
  return (config.shortcuts ?? []).filter((shortcut) => shortcut.member === member);
}

export function addShortcut(config: Config, name: string, options: { member: string; folder: string; hotkey?: string }, run: LinkRunner = writeLink): Shortcut {
  checkName('shortcut', name);
  if (config.shortcuts?.some((entry) => entry.name === name)) throw new Error(`Shortcut ${name} already exists. Change it with: crew shortcut set ${name}`);
  memberOrThrow(config, options.member);
  if (process.platform === 'win32' && fs.existsSync(launcherFile(name))) throw new Error(`The Start Menu already has ${launcherFile(name)}. Pick another name.`); // names there ignore case
  const shortcut: Shortcut = { name, member: options.member, folder: parseFolder(options.folder), ...(options.hotkey ? { hotkey: parseHotkey(options.hotkey) } : {}) };
  writeShortcut(shortcut, run);
  config.shortcuts = [...(config.shortcuts ?? []), shortcut];
  saveConfig(config);
  return shortcut;
}

export function setShortcut(config: Config, name: string, options: { member?: string; folder?: string; hotkey?: string | null }, run: LinkRunner = writeLink): Shortcut {
  const shortcut = shortcutOrThrow(config, name);
  if (options.member) memberOrThrow(config, options.member);
  const folder = options.folder ? parseFolder(options.folder) : shortcut.folder;
  const hotkey = options.hotkey === null ? undefined : options.hotkey ? parseHotkey(options.hotkey) : shortcut.hotkey;
  const changed: Shortcut = { name, member: options.member ?? shortcut.member, folder, ...(hotkey ? { hotkey } : {}) };
  writeShortcut(changed, run);
  config.shortcuts = config.shortcuts!.map((entry) => (entry.name === name ? changed : entry));
  saveConfig(config);
  return changed;
}

// Plain files crewrota made; never a folder, never through a link.
export function removeShortcut(config: Config, name: string): void {
  shortcutOrThrow(config, name);
  deleteFiles(name);
  config.shortcuts = config.shortcuts!.filter((entry) => entry.name !== name);
  saveConfig(config);
}

// Saves the config first, then rewrites each file, so a failed write leaves the config right.
export function repointShortcuts(config: Config, from: string, to: string, run: LinkRunner = writeLink): Shortcut[] {
  const moved = memberShortcuts(config, from);
  if (moved.length === 0) return moved;
  for (const shortcut of moved) shortcut.member = to;
  saveConfig(config);
  for (const shortcut of moved) writeShortcut(shortcut, run);
  return moved;
}

export const startDetached: Starter = (command, args) => {
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
};

export function openShortcut(config: Config, name: string, start: Starter = startDetached): string {
  shortcutOrThrow(config, name);
  const file = workspaceFile(name);
  if (!fs.existsSync(file)) throw new Error(`${file} is missing. Write it again with: crew shortcut set ${name}`);
  const code = codeOrThrow();
  start(code, [file]);
  return code;
}
