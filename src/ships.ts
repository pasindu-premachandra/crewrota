import fs from 'node:fs';
import path from 'node:path';
import { type Config, saveConfig } from './config.js';
import { freePath, linkState, lstatOrNull, makeDirLink, renameFolder, stamp } from './links.js';
import { memberDir, shipDir, shipsDir } from './paths.js';
import { mainMcpServers } from './shared.js';

// What members on one ship share, as a ccs context group does: history and memory, then the session folders.
export const SHIP_FOLDERS = ['projects', 'todos', 'file-history', 'session-env', 'shell-snapshots'];

type Servers = Record<string, unknown>;

// Folders merge; a file whose name is taken arrives as <name>.incoming-<n><ext>.
function copyMerge(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyMerge(source, target);
      continue;
    }
    const ext = path.extname(entry.name);
    const stem = path.basename(entry.name, ext);
    const free = freePath((n) => (n === 0 ? target : path.join(to, `${stem}.incoming-${n}${ext}`)));
    fs.cpSync(source, free, { verbatimSymlinks: true });
  }
}

export interface ImportCount {
  copied: number;
  updated: number;
  kept: number;
  skipped: number;
}

function startsWith(file: string, prefix: string): boolean {
  const head = Buffer.alloc(fs.statSync(prefix).size);
  const handle = fs.openSync(file, 'r');
  try {
    fs.readSync(handle, head, 0, head.length, 0);
  } finally {
    fs.closeSync(handle);
  }
  return head.equals(fs.readFileSync(prefix));
}

// New files are copied; the same file is skipped; a transcript that only grew in the source is brought up to date;
// a file changed on both sides arrives beside it as <name>.incoming-<n><ext>, so nothing is overwritten.
export function importFolder(from: string, to: string, count: ImportCount): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      importFolder(source, target, count);
      continue;
    }
    if (!entry.isFile()) continue;
    const there = lstatOrNull(target);
    if (!there) {
      fs.copyFileSync(source, target);
      count.copied++;
      continue;
    }
    const size = fs.statSync(source).size;
    if (there.size === size && fs.readFileSync(target).equals(fs.readFileSync(source))) {
      count.skipped++;
    } else if (size > there.size && startsWith(source, target)) {
      fs.copyFileSync(source, target);
      count.updated++;
    } else {
      const ext = path.extname(entry.name);
      const stem = path.basename(entry.name, ext);
      const incoming = (n: number) => path.join(to, `${stem}.incoming-${n + 1}${ext}`);
      const content = fs.readFileSync(source);
      let n = 0;
      while (lstatOrNull(incoming(n)) && !fs.readFileSync(incoming(n)).equals(content)) n++;
      if (lstatOrNull(incoming(n))) {
        count.skipped++; // brought in by an earlier run
      } else {
        fs.copyFileSync(source, incoming(n));
        count.kept++;
      }
    }
  }
}

// Copies another tool's history into a ship, read only on the source side. A folder may sit at <from>/<name>
// or, as ccs lays out a context group, at <from>/continuity/<name>.
export function importIntoShip(ship: string, from: string, names: string[] = SHIP_FOLDERS): Record<string, ImportCount> {
  const counts: Record<string, ImportCount> = {};
  for (const name of names) {
    const source = [path.join(from, name), path.join(from, 'continuity', name)].find((folder) => fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory());
    if (!source) continue;
    counts[name] = { copied: 0, updated: 0, kept: 0, skipped: 0 };
    importFolder(source, shipFolder(ship, name), counts[name]);
  }
  return counts;
}

export function projectsLink(member: string): string {
  return path.join(memberDir(member), 'projects');
}

export function shipFolder(ship: string, name: string): string {
  return path.join(shipDir(ship), name);
}

// Makes <dir>/<name> a link to target; what the member had is moved aside and copied in, never deleted.
export function linkShipFolder(dir: string, name: string, target: string, now = new Date()): string[] {
  const notes: string[] = [];
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const link = path.join(dir, name);
  const stat = lstatOrNull(link);
  if (stat?.isSymbolicLink()) {
    if (linkState(link, target) === 'ok') return notes;
    fs.unlinkSync(link);
  } else if (stat?.isDirectory() && name !== 'projects' && fs.readdirSync(link).length === 0) {
    fs.rmdirSync(link);
  } else if (stat?.isDirectory()) {
    const base = path.join(dir, `${name}.before-crewrota-${stamp(now, false)}`);
    const aside = freePath((n) => (n === 0 ? base : `${base}-${n + 1}`));
    renameFolder(link, aside);
    copyMerge(aside, target);
    const what = name === 'projects' ? 'history' : name;
    notes.push(`Copied this member's ${what} into the ship. The original folder is kept at ${aside}`);
  } else if (stat) {
    throw new Error(`${link} is a file, not a folder. Move it somewhere else and try again.`);
  }
  makeDirLink(target, link);
  return notes;
}

function linkAll(member: string, ship: string): string[] {
  return SHIP_FOLDERS.flatMap((name) => linkShipFolder(memberDir(member), name, shipFolder(ship, name)));
}

export function shipMcpFile(ship: string): string {
  return path.join(shipDir(ship), 'mcp.json');
}

// A ship without its own MCP list starts with a copy of the main setup's (S4, 26 Oct 2026).
export function readShipMcp(ship: string): Servers {
  const file = shipMcpFile(ship);
  if (!fs.existsSync(file)) writeShipMcp(ship, (mainMcpServers() ?? {}) as Servers);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${(error as Error).message}). Nothing launched.`);
  }
  return data?.mcpServers && typeof data.mcpServers === 'object' ? data.mcpServers : {};
}

export function writeShipMcp(ship: string, servers: Servers): void {
  fs.mkdirSync(shipDir(ship), { recursive: true });
  fs.writeFileSync(shipMcpFile(ship), JSON.stringify({ mcpServers: servers }, null, 2) + '\n', { mode: 0o600 });
}

export function shipExists(ship: string): boolean {
  return fs.existsSync(shipDir(ship));
}

export function createShip(ship: string): void {
  for (const name of SHIP_FOLDERS) fs.mkdirSync(shipFolder(ship, name), { recursive: true });
  readShipMcp(ship);
}

export function listShips(config: Config): string[] {
  const names = new Set(fs.existsSync(shipsDir()) ? fs.readdirSync(shipsDir()) : []);
  for (const member of Object.values(config.members)) if (member.ship) names.add(member.ship);
  return [...names].sort();
}

export function shipMembers(config: Config, ship: string): string[] {
  return Object.keys(config.members)
    .filter((member) => config.members[member].ship === ship)
    .sort();
}

export function joinShip(config: Config, member: string, ship: string): string[] {
  config.members[member].ship = ship;
  return linkAll(member, ship);
}

export function healShipLink(config: Config, member: string): string[] {
  const ship = config.members[member]?.ship;
  if (!ship) return [];
  return linkAll(member, ship);
}

export function leaveShip(config: Config, member: string): string[] {
  const entry = config.members[member];
  if (!entry?.ship) return [`${member} is not linked to a ship.`];
  const ship = entry.ship;
  delete entry.ship;
  for (const name of SHIP_FOLDERS) {
    const link = path.join(memberDir(member), name);
    if (lstatOrNull(link)?.isSymbolicLink()) {
      fs.unlinkSync(link);
      fs.mkdirSync(link);
    }
  }
  return [`${member} is isolated again. The ship's files stay in ${shipDir(ship)}`];
}

// Renames the folder, saves the new name, then re-points every member's link.
export function renameShip(config: Config, from: string, to: string): string[] {
  renameFolder(shipDir(from), shipDir(to));
  const members = shipMembers(config, from);
  for (const member of members) config.members[member].ship = to;
  saveConfig(config);
  return members.flatMap((member) => healShipLink(config, member));
}
