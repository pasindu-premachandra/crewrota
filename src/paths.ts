import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = fileURLToPath(new URL('..', import.meta.url));

export function configDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'crewrota');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, 'crewrota');
}

export function configFile(): string {
  return path.join(configDir(), 'config.json');
}

export function crewHome(): string {
  const home = process.env.CREWROTA_HOME;
  return home ? path.resolve(home) : path.join(os.homedir(), '.crewrota');
}

export function membersDir(): string {
  return path.join(crewHome(), 'members');
}

export function memberDir(member: string): string {
  return path.join(membersDir(), member);
}

export function shipsDir(): string {
  return path.join(crewHome(), 'ships');
}

export function shipDir(ship: string): string {
  return path.join(shipsDir(), ship);
}

export function shipProjectsDir(ship: string): string {
  return path.join(shipDir(ship), 'projects');
}

export function removedDir(): string {
  return path.join(crewHome(), 'removed');
}

export function mainClaudeDir(): string {
  return path.join(os.homedir(), '.claude');
}

export function mainClaudeJson(): string {
  return path.join(os.homedir(), '.claude.json');
}

export function samePath(a: string, b: string): boolean {
  const normal = (file: string) => (process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file));
  return normal(a) === normal(b);
}
