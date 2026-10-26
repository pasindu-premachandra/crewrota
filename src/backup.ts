import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Config, loadConfig, saveConfig } from './config.js';
import { findLinks, lstatOrNull, stamp } from './links.js';
import { checkName } from './names.js';
import { configFile, crewHome, memberDir, shipsDir } from './paths.js';
import { say } from './say.js';
import { type ImportCount, SHIP_FOLDERS, createShip, importFolder, importIntoShip, joinShip, readShipMcp, shipExists, shipMcpFile, writeShipMcp } from './ships.js';

type Servers = Record<string, unknown>;

interface Manifest {
  format: number;
  crewrota: string;
  created: string;
  platform: string;
  home: string;
  ships: string[];
  members: Record<string, { ship?: string; model?: string; effort?: string }>;
}

export interface BackupOptions {
  to?: string;
  password?: string;
  version: string;
  now?: Date;
}

export interface RestoreOptions {
  maps: [string, string][];
  password?: string;
  now?: Date;
}

// Windows ships bsdtar as System32\tar.exe; the tar on PATH there may be GNU tar, which cannot write a zip.
export function tarPath(): string {
  if (process.env.CREWROTA_TAR) return process.env.CREWROTA_TAR;
  if (process.platform === 'win32') {
    const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(tar)) return tar;
  } else {
    for (const name of ['bsdtar', 'tar']) {
      const result = spawnSync(name, ['--version'], { encoding: 'utf8' });
      if (result.status === 0 && result.stdout.includes('bsdtar')) return name;
    }
  }
  throw new Error('crewrota needs bsdtar to write and read a backup zip (on Linux, install libarchive-tools).');
}

function runTar(tar: string, args: string[]): void {
  const result = spawnSync(tar, args, { encoding: 'utf8' });
  if (result.error) throw new Error(`Could not run ${tar}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`bsdtar failed: ${result.stderr.trim() || `exit code ${result.status}`}`);
}

function passphrase(password: string | undefined): string[] {
  return password ? ['--options', 'zip:encryption=aes256', '--passphrase', password] : [];
}

// Claude Code names a project folder after its absolute path, every character but an ASCII letter or digit made a hyphen.
export function projectSlug(folder: string): string {
  return folder.replace(/[^A-Za-z0-9]/g, '-');
}

// Longest prefix first; a name matches a prefix only when it equals it or goes on with a hyphen.
export function remapName(name: string, remaps: [string, string][]): [string, string] | null {
  const remap = [...remaps].sort((a, b) => b[0].length - a[0].length).find(([from]) => name === from || name.startsWith(`${from}-`));
  return remap ? [remap[0], remap[1] + name.slice(remap[0].length)] : null;
}

// Our own backups start with manifest.json, so the first entry's flags tell whether the zip is encrypted.
export function zipEncrypted(file: string): boolean {
  const head = Buffer.alloc(8);
  const handle = fs.openSync(file, 'r');
  try {
    fs.readSync(handle, head, 0, head.length, 0);
  } finally {
    fs.closeSync(handle);
  }
  return head.readUInt32LE(0) === 0x04034b50 && (head.readUInt16LE(6) & 1) === 1;
}

function readJson(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${(error as Error).message}).`);
  }
}

function servers(file: string): Servers | null {
  const data = readJson(file)?.mcpServers;
  return data && typeof data === 'object' ? (data as Servers) : null;
}

function formatSize(bytes: number): string {
  const units = ['KB', 'MB', 'GB'];
  let size = bytes;
  let unit = -1;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return unit === -1 ? `${bytes} bytes` : `${size.toFixed(1)} ${units[unit]}`;
}

function shipFolders(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// One zip: the manifest and settings from a temp folder, then the ships straight from the crew home. Never a member folder.
export function backup(config: Config, options: BackupOptions, log: (line: string) => void = console.log): string {
  const tar = tarPath();
  const now = options.now ?? new Date();
  const folder = path.resolve(options.to ?? '.');
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `crewrota-backup-${stamp(now)}.zip`);
  if (lstatOrNull(file)) throw new Error(`${file} already exists. Wait a minute, or pick another folder with --to.`);

  const ships = shipFolders(shipsDir());
  const members: Manifest['members'] = {};
  for (const [name, member] of Object.entries(config.members)) {
    members[name] = {
      ...(member.ship ? { ship: member.ship } : {}),
      ...(member.model ? { model: member.model } : {}),
      ...(member.effort ? { effort: member.effort } : {}),
    };
  }
  const manifest: Manifest = { format: 1, crewrota: options.version, created: now.toISOString(), platform: process.platform, home: os.homedir(), ships, members };
  const withServers = ships.filter((ship) => Object.keys(servers(path.join(shipsDir(), ship, 'mcp.json')) ?? {}).length > 0);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crewrota-backup-'));
  try {
    fs.writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    if (fs.existsSync(configFile())) fs.copyFileSync(configFile(), path.join(temp, 'config.json'));
    else fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify(config, null, 2) + '\n');
    const shipArgs = ships.length > 0 ? ['-C', crewHome(), 'ships'] : [];
    runTar(tar, ['-a', '-c', '-f', file, ...passphrase(options.password), '-C', temp, 'manifest.json', 'config.json', ...shipArgs]);
  } catch (error) {
    if (lstatOrNull(file)) fs.unlinkSync(file);
    throw error;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  if (!options.password && withServers.length > 0) {
    log(say('warn', `The backup holds the MCP servers of ${withServers.join(', ')} with their keys in plain text. Add --password to encrypt it.`));
  }
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  log(say('ok', `Backup written: ${file}`));
  log(say('info', `${formatSize(fs.statSync(file).size)}, ${count(ships.length, 'ship')}, ${count(Object.keys(members).length, 'member')}${options.password ? ', encrypted' : ''}`));
  log(say('info', 'No login is in it: after a restore, each member signs in again with crew login <member>.'));
  return file;
}

function sum(counts: Record<string, ImportCount>): ImportCount {
  const total = { copied: 0, updated: 0, kept: 0, skipped: 0 };
  for (const count of Object.values(counts)) {
    total.copied += count.copied;
    total.updated += count.updated;
    total.kept += count.kept;
    total.skipped += count.skipped;
  }
  return total;
}

// Renames the extracted project folders to this machine's paths; a name already taken is merged by the import rule.
function remapProjects(dir: string, remaps: [string, string][], renamed: Map<string, number>): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const match = remapName(name, remaps);
    if (!match) continue;
    const [from, to] = match;
    const source = path.join(dir, name);
    const target = path.join(dir, to);
    if (lstatOrNull(target)) {
      importFolder(source, target, { copied: 0, updated: 0, kept: 0, skipped: 0 });
      fs.rmSync(source, { recursive: true, force: true }); // inside the fresh extract, checked for links already
    } else {
      fs.renameSync(source, target);
    }
    renamed.set(from, (renamed.get(from) ?? 0) + 1);
  }
}

// Only for the extract folder crewrota made moments ago, and only while no link exists in it.
function discardExtract(dir: string, log: (line: string) => void): void {
  if (!fs.existsSync(dir)) return;
  const links = findLinks(dir);
  if (links.length > 0) {
    log(say('warn', `${dir} holds a link (${links[0]}), so crewrota left the folder in place.`));
    return;
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// Ships merged in, missing members re-created without a login, project folders renamed to this machine's paths.
export function restore(config: Config, zip: string, options: RestoreOptions, log: (line: string) => void = console.log): string[] {
  const file = path.resolve(zip);
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`${zip} is not a file`);
  if (!options.password && zipEncrypted(file)) throw new Error(`${zip} is encrypted. Add --password.`);
  const tar = tarPath();
  const now = options.now ?? new Date();
  fs.mkdirSync(crewHome(), { recursive: true });
  const extract = path.join(crewHome(), `restore-${stamp(now)}${String(now.getSeconds()).padStart(2, '0')}`);
  fs.mkdirSync(extract);
  try {
    try {
      runTar(tar, ['-x', '-f', file, '-C', extract, ...(options.password ? ['--passphrase', options.password] : [])]);
    } catch (error) {
      if (/passphrase/i.test((error as Error).message)) throw new Error(options.password ? `The password does not open ${zip}.` : `${zip} is encrypted. Add --password.`);
      throw error;
    }
    const links = findLinks(extract);
    if (links.length > 0) throw new Error(`The backup holds a link (${path.relative(extract, links[0])}), so crewrota restored nothing from it.`);
    const manifest = readJson(path.join(extract, 'manifest.json')) as Manifest | null;
    if (!manifest) throw new Error(`${zip} is not a crewrota backup: it has no manifest.json.`);
    if (manifest.format !== 1) throw new Error(`${zip} has backup format ${manifest.format}; this crewrota reads format 1. Update crewrota and try again.`);

    const extractShips = path.join(extract, 'ships');
    const ships = shipFolders(extractShips);
    const members = Object.entries(manifest.members ?? {});
    for (const ship of ships) checkName('ship', ship);
    for (const [name, member] of members) {
      checkName('crew member', name);
      if (member.ship) checkName('ship', member.ship);
    }

    const remaps: [string, string][] = options.maps.map(([from, to]) => [projectSlug(from), projectSlug(to)]);
    if (manifest.home) remaps.push([projectSlug(manifest.home), projectSlug(os.homedir())]);
    const useful = remaps.filter(([from, to], at) => from !== to && remaps.findIndex(([other]) => other === from) === at);
    const renamed = new Map<string, number>();
    for (const ship of ships) remapProjects(path.join(extractShips, ship, 'projects'), useful, renamed);
    for (const [from, to] of useful) log(say('info', `Project folders ${from} renamed to ${to}: ${renamed.get(from) ?? 0}`));

    for (const ship of ships) {
      const hadMcp = fs.existsSync(shipMcpFile(ship));
      const isNew = !shipExists(ship);
      if (isNew) createShip(ship);
      const total = sum(importIntoShip(ship, path.join(extractShips, ship), SHIP_FOLDERS));
      log(say('ok', `Ship ${ship}${isNew ? ' (new)' : ''}: ${total.copied} copied, ${total.updated} brought up to date, ${total.skipped} already there, ${total.kept} kept beside a changed copy`));
      const archived = servers(path.join(extractShips, ship, 'mcp.json'));
      if (!archived) continue;
      if (!hadMcp) {
        writeShipMcp(ship, archived);
        continue;
      }
      const current = readShipMcp(ship);
      const added = Object.keys(archived).filter((name) => !(name in current));
      if (added.length === 0) continue;
      for (const name of added) current[name] = archived[name];
      writeShipMcp(ship, current);
      log(say('info', `Added to ship ${ship}'s MCP servers: ${added.join(', ')}`));
    }

    const created: string[] = [];
    const kept: string[] = [];
    for (const [name, member] of members) {
      if (config.members[name]) {
        kept.push(name);
        continue;
      }
      const dir = memberDir(name);
      if (lstatOrNull(dir)) {
        log(say('warn', `${dir} already exists but is not a crew member, so ${name} was not re-created.`));
        continue;
      }
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      config.members[name] = {
        provider: 'claude',
        ...(member.model ? { model: member.model } : {}),
        ...(member.effort ? { effort: member.effort } : {}),
        created: now.toISOString(),
      };
      if (member.ship) {
        if (!shipExists(member.ship)) createShip(member.ship);
        for (const note of joinShip(config, name, member.ship)) log(say('info', note));
      }
      created.push(name);
    }

    const archivedConfig = path.join(extract, 'config.json');
    if (fs.existsSync(archivedConfig)) {
      const settings = loadConfig(archivedConfig);
      if (config.skipPermissions === null && settings.skipPermissions !== null) config.skipPermissions = settings.skipPermissions;
      config.refreshReadings ??= settings.refreshReadings;
      config.lavishRule ??= settings.lavishRule;
      config.lavishTelemetry ??= settings.lavishTelemetry;
      config.lastModel ??= settings.lastModel;
      config.lastEffort ??= settings.lastEffort;
      for (const key of ['current', 'previous'] as const) {
        const name = settings[key];
        if (!config[key] && name && config.members[name]) config[key] = name;
      }
    }
    saveConfig(config);

    log('');
    log(say('ok', `Restored ${ships.length} ship${ships.length === 1 ? '' : 's'} and ${created.length} member${created.length === 1 ? '' : 's'} from ${zip}`));
    if (kept.length > 0) log(say('info', `Already here, left alone: ${kept.join(', ')}`));
    if (created.length > 0) {
      log(say('info', 'Logins are never in a backup. Sign each new member in:'));
      for (const name of created) log(`  crew login ${name}`);
    }
    return created;
  } finally {
    discardExtract(extract, log);
  }
}
