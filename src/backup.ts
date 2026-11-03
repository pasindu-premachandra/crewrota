import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Config, loadConfig, saveConfig } from './config.js';
import { findLinks, lstatOrNull, stamp } from './links.js';
import { checkName } from './names.js';
import { type CopyStats, type Repo, cloneRepo, copyTree, emptyStats, findRepos, findRoots, installedPlugins, knownFolders, mapFolder, skillNames } from './context.js';
import { configFile, crewHome, mainClaudeDir, memberDir, shipsDir } from './paths.js';
import { progress } from './progress.js';
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
  context?: BackupContext;
  renamed?: Record<string, string>;
}

interface BackupContext {
  roots: { id: string; path: string }[];
  repos: Repo[];
  skills: string[];
  plugins: string[];
}

export interface BackupOptions {
  to?: string;
  password?: string;
  version: string;
  now?: Date;
  skip?: string[];
  context?: boolean;
  dryRun?: boolean;
}

export interface RestoreOptions {
  maps: [string, string][];
  password?: string;
  clone?: boolean;
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

// bsdtar -v prints one "a <name>" (create) or "x <name>" (extract) line per entry, which moves the bar.
function runTar(tar: string, args: string[], label: string, total: number): Promise<void> {
  const bar = progress(label);
  return new Promise((resolve, reject) => {
    const child = spawn(tar, ['-v', ...args], { windowsHide: true });
    const tail: string[] = [];
    let done = 0;
    let rest = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? '';
      for (const line of lines) {
        if (/^[ax] /.test(line)) done++;
        if (/^[ax] [^:]*$/.test(line) || !line.trim()) continue;
        tail.push(line);
        if (tail.length > 5) tail.shift();
      }
      bar.update(done, total, total > 0 ? `${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} files` : `${done.toLocaleString('en-US')} files`);
    });
    child.on('error', (error) => {
      bar.end();
      reject(new Error(`Could not run ${tar}: ${error.message}`));
    });
    child.on('close', (code) => {
      bar.end();
      if (rest.trim() && !/^[ax] [^:]*$/.test(rest)) tail.push(rest);
      if (code === 0) resolve();
      else reject(new Error(`bsdtar failed: ${tail.join('\n').trim() || `exit code ${code}`}`));
    });
  });
}

// Files and folders below dir, plus dir itself: what bsdtar will list for it.
function countEntries(dir: string): number {
  let count = 1;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    count += entry.isDirectory() ? countEntries(path.join(dir, entry.name)) : 1;
  }
  return count;
}

// The entry count from the zip's end record (the ZIP64 one above 65,535 entries), so the restore bar has a total.
export function zipEntryCount(file: string): number {
  const size = fs.statSync(file).size;
  const length = Math.min(size, 65_557);
  const tail = Buffer.alloc(length);
  const handle = fs.openSync(file, 'r');
  try {
    fs.readSync(handle, tail, 0, length, size - length);
    const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0) return 0;
    const count = tail.readUInt16LE(end + 10);
    if (count !== 0xffff || end < 20 || tail.readUInt32LE(end - 20) !== 0x07064b50) return count;
    const record = Buffer.alloc(40);
    fs.readSync(handle, record, 0, record.length, Number(tail.readBigUInt64LE(end - 12)));
    return record.readUInt32LE(0) === 0x06064b50 ? Number(record.readBigUInt64LE(32)) : 0;
  } finally {
    fs.closeSync(handle);
  }
}

// One --options string: a second flag silently replaces the first and would drop the encryption. Without UTF-8, names outside the ANSI code page come back as underscores.
function zipOptions(password: string | undefined): string[] {
  return password ? ['--options', 'zip:hdrcharset=UTF-8,zip:encryption=aes256', '--passphrase', password] : ['--options', 'zip:hdrcharset=UTF-8'];
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

function trackedByGit(folder: string, name: string): boolean {
  const result = spawnSync('git', ['-C', folder, 'ls-files', '--', name], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 && result.stdout.trim() !== '';
}

// Every project .claude, a CLAUDE.md git will not bring back, and the main setup's skills, agents, commands and CLAUDE.md.
// With a stage folder they are copied there, links resolved; without one they are only measured.
function gatherContext(config: Config, skip: string[], stage: string | null): { context: BackupContext; stats: CopyStats } {
  const at = (...parts: string[]) => (stage ? path.join(stage, 'context', ...parts) : null);
  const folders = knownFolders(config);
  const roots = findRoots(folders, skip).map((root, index) => ({ id: `r${index + 1}`, path: root }));
  const notStage = stage ? [...skip, fs.realpathSync.native(stage)] : skip; // --to may sit inside a .claude
  const main = mainClaudeDir();
  const skills = skillNames(path.join(main, 'skills'));
  const trees: [string, string | null][] = [
    ...roots.map((root): [string, string | null] => [path.join(root.path, '.claude'), at('roots', root.id, '.claude')]),
    ...skills.map((name): [string, string | null] => [path.join(main, 'skills', name), at('main', 'skills', name)]),
    ...['agents', 'commands'].filter((name) => fs.existsSync(path.join(main, name))).map((name): [string, string | null] => [path.join(main, name), at('main', name)]),
  ];

  const measure = { ...emptyStats(), quick: true };
  for (const [from] of trees) copyTree(from, null, measure, notStage);
  const bar = progress(stage ? 'Copying' : 'Reading');
  let done = 0;
  const stats: CopyStats = {
    ...emptyStats(),
    onFile: (bytes) => {
      done += bytes;
      bar.update(done, measure.bytes, `${formatSize(done)} of ${formatSize(measure.bytes)}`);
    },
  };
  for (const [from, to] of trees) copyTree(from, to, stats, notStage);
  bar.end();

  const notes: [string, string | null][] = roots.map((root) => [path.join(root.path, 'CLAUDE.md'), at('roots', root.id, 'CLAUDE.md')]);
  notes.push([path.join(main, 'CLAUDE.md'), at('main', 'files', 'CLAUDE.md')]);
  for (const [file, target] of notes) {
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile() || trackedByGit(path.dirname(file), 'CLAUDE.md')) continue;
    if (target) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
    }
    stats.files++;
    stats.bytes += fs.statSync(file).size;
  }

  const checking = progress('Checking repos');
  const repos = findRepos([...folders, ...roots.map((root) => root.path)], skip, (index, total) => checking.update(index, total, `${index} of ${total}`));
  checking.end();
  return { context: { roots, repos, skills, plugins: installedPlugins() }, stats };
}

function reportContext({ context, stats }: { context: BackupContext; stats: CopyStats }, encrypted: boolean, log: (line: string) => void): void {
  log(say('info', `${context.roots.length} project .claude folders and ${context.skills.length} skills: ${stats.files} files, ${formatSize(stats.bytes)}`));
  const largest = [...stats.folders].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (largest.length > 0) {
    log(say('info', 'Largest (leave one out with --skip <folder>):'));
    for (const [folder, bytes] of largest) log(`  ${formatSize(bytes).padStart(10)}  ${folder}`);
  }
  if (stats.withheld.length > 0) {
    log(say('info', `${stats.withheld.length} login or key files stayed behind: ${stats.withheld.slice(0, 5).join(', ')}${stats.withheld.length > 5 ? ' and more' : ''}`));
  }
  if (stats.left.length > 0) log(say('warn', `Could not read ${stats.left.length}, left out: ${stats.left.slice(0, 5).join(', ')}`));
  for (const repo of context.repos) {
    const missing = [
      ...(repo.remote ? [] : ['no remote']),
      ...(repo.changed > 0 ? [`${repo.changed} changed files`] : []),
      ...(repo.unpushed > 0 ? [`${repo.unpushed} unpushed commits`] : []),
      ...(repo.changed < 0 || repo.unpushed < 0 ? ['git could not check it in time'] : []),
    ];
    if (missing.length > 0) log(say('warn', `${repo.path}: ${missing.join(', ')}. Only pushed code comes back on a new machine.`));
  }
  if (!encrypted && stats.secrets.length > 0) {
    const files = [...new Set(stats.secrets.map(({ file }) => file))];
    log(say('warn', `${files.length} files look like they hold a key (${[...new Set(stats.secrets.map(({ rule }) => rule))].join(', ')}). Add --password to encrypt the backup:`));
    for (const file of files.slice(0, 10)) log(`  ${file}`);
    if (files.length > 10) log(`  and ${files.length - 10} more`);
  }
}

// Windows' own tar (bsdtar 3.8) crashes on a name outside the ANSI code page, so such names go in as ~crewN and the manifest maps them back.
function asciiNames(dir: string, base: string, renamed: Record<string, string>): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    let name = entry.name;
    if (/[^ -~]/.test(name)) {
      let n = Object.keys(renamed).length;
      do name = `~crew${++n}`; while (fs.existsSync(path.join(dir, name)));
      fs.renameSync(path.join(dir, entry.name), path.join(dir, name));
      renamed[`${base}/${name}`] = entry.name;
    }
    if (entry.isDirectory()) asciiNames(path.join(dir, name), `${base}/${name}`, renamed);
  }
}

function restoreNames(extract: string, renamed: Record<string, string>): void {
  const deepestFirst = Object.entries(renamed).sort(([a], [b]) => b.split('/').length - a.split('/').length);
  for (const [entry, name] of deepestFirst) {
    const parts = entry.split('/');
    if (parts[0] !== 'context' || parts.some((part) => part === '..' || part === '.') || /[\\/]/.test(name) || name === '..' || name === '.') {
      throw new Error(`The backup renames ${entry} to ${name}, which is outside its context folder, so crewrota restored nothing from it.`);
    }
    const from = path.join(extract, ...parts);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(path.dirname(from), name));
  }
}

// One zip: the manifest, settings and context from a stage folder, then the ships straight from the crew home. Never a member folder.
export async function backup(config: Config, options: BackupOptions, log: (line: string) => void = console.log): Promise<string> {
  for (const folder of options.skip ?? []) if (!fs.existsSync(folder)) log(say('warn', `--skip ${folder}: no such folder.`));
  const skip = (options.skip ?? []).filter((folder) => fs.existsSync(folder)).map((folder) => fs.realpathSync.native(folder));
  if (options.dryRun) {
    const withKeys = shipFolders(shipsDir()).filter((ship) => Object.keys(servers(path.join(shipsDir(), ship, 'mcp.json')) ?? {}).length > 0);
    if (withKeys.length > 0) log(say('warn', `The backup holds the MCP servers of ${withKeys.join(', ')} with their keys in plain text. Add --password to encrypt it.`));
    reportContext(gatherContext(config, skip, null), Boolean(options.password), log);
    log(say('info', 'Dry run: nothing written.'));
    return '';
  }
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
  const manifest: Manifest = { format: 2, crewrota: options.version, created: now.toISOString(), platform: process.platform, home: os.homedir(), ships, members };
  const withServers = ships.filter((ship) => Object.keys(servers(path.join(shipsDir(), ship, 'mcp.json')) ?? {}).length > 0);

  // Beside the zip, not in the system temp folder: the context can be gigabytes and the zip's drive has to hold them anyway.
  const temp = fs.mkdtempSync(path.join(folder, '.crew-stage-'));
  let gathered: { context: BackupContext; stats: CopyStats } | null = null;
  try {
    if (options.context !== false) {
      gathered = gatherContext(config, skip, temp);
      manifest.context = gathered.context;
      const renamed: Record<string, string> = {};
      if (fs.existsSync(path.join(temp, 'context'))) asciiNames(path.join(temp, 'context'), 'context', renamed);
      if (Object.keys(renamed).length > 0) manifest.renamed = renamed;
    }
    fs.writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    if (fs.existsSync(configFile())) fs.copyFileSync(configFile(), path.join(temp, 'config.json'));
    else fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify(config, null, 2) + '\n');
    const contextArgs = fs.existsSync(path.join(temp, 'context')) ? ['context'] : [];
    const shipArgs = ships.length > 0 ? ['-C', crewHome(), 'ships'] : [];
    const entries = 2 + (contextArgs.length > 0 ? countEntries(path.join(temp, 'context')) : 0) + (ships.length > 0 ? countEntries(shipsDir()) : 0);
    await runTar(tar, ['-a', '-c', '-f', file, ...zipOptions(options.password), '-C', temp, 'manifest.json', 'config.json', ...contextArgs, ...shipArgs], 'Zipping', entries);
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
  if (gathered) reportContext(gathered, Boolean(options.password), log);
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
    if (to.length > 200) console.log(say('warn', `${to.slice(0, 60)}... is over 200 characters. Claude Code shortens such a name with its own hash, so that project's history will not be found there. Pick a shorter folder with --map.`));
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

function mergeInto(from: string, to: string, total: ImportCount, mode: 'keep' | 'replace' = 'keep'): void {
  if (fs.statSync(from, { throwIfNoEntry: false })?.isDirectory()) importFolder(from, to, total, mode);
}

function isBelow(file: string, folders: string[]): boolean {
  return folders.some((folder) => file === folder || file.startsWith(folder + path.sep));
}

// The main setup is added to, never overwritten. A skill that is a link here stays as it is.
function restoreMain(context: string, log: (line: string) => void): void {
  const main = mainClaudeDir();
  const total: ImportCount = { copied: 0, updated: 0, kept: 0, skipped: 0 };
  const skills = path.join(context, 'main', 'skills');
  const names = fs.existsSync(skills) ? fs.readdirSync(skills) : [];
  for (const name of names) {
    const target = path.join(main, 'skills', name);
    if (lstatOrNull(target)?.isSymbolicLink()) {
      log(say('info', `Skill ${name} is a link here, left alone.`));
      continue;
    }
    importFolder(path.join(skills, name), target, total, 'keep');
  }
  mergeInto(path.join(context, 'main', 'agents'), path.join(main, 'agents'), total);
  mergeInto(path.join(context, 'main', 'commands'), path.join(main, 'commands'), total);
  mergeInto(path.join(context, 'main', 'files'), main, total);
  log(say('ok', `Main setup (${names.length} skills): ${total.copied} copied, ${total.updated} brought up to date, ${total.skipped} already there, ${total.kept} kept beside a changed copy`));
}

// Clones first when asked, so a restored .claude lands in the checkout rather than blocking the clone.
function restoreContext(manifest: Manifest, context: string, options: RestoreOptions, log: (line: string) => void): void {
  const saved = manifest.context as BackupContext;
  restoreMain(context, log);

  const place = (folder: string) => mapFolder(folder, options.maps, manifest.platform, manifest.home);
  const total: ImportCount = { copied: 0, updated: 0, kept: 0, skipped: 0 };
  const waiting: string[] = [];
  const fresh: string[] = [];
  for (const repo of saved.repos ?? []) {
    const folder = place(repo.path);
    if (!folder) {
      waiting.push(repo.path);
      continue;
    }
    if (!repo.remote) {
      log(say('warn', `${folder} had no remote, so its code is not coming back.`));
      continue;
    }
    if (fs.existsSync(path.join(folder, '.git'))) continue;
    if (!options.clone) {
      log(say('info', `Code not here yet: ${folder} (${repo.remote}). Add --clone to fetch it.`));
      continue;
    }
    const empty = !fs.existsSync(folder) || fs.readdirSync(folder).length === 0;
    // What this machine already had stays on top of the clone; git shows any difference from the remote.
    const result = cloneRepo(repo.remote, folder, repo.branch, (from, to) => importFolder(from, to, total, 'replace'));
    if (result === 'cloned') {
      log(say('ok', `Cloned ${repo.remote} into ${folder}`));
      if (empty) fresh.push(folder);
    }
    if (result === 'failed') log(say('warn', `Could not clone ${repo.remote} into ${folder}. Its .claude still comes back; run this again once you have access.`));
    if (result === 'in-the-way') log(say('warn', `${folder} already holds other files, so ${repo.remote} was not cloned.`));
  }

  let placed = 0;
  const roots = saved.roots ?? [];
  const bar = progress('Putting back');
  for (const [index, root] of roots.entries()) {
    bar.update(index, roots.length, root.path);
    const folder = place(root.path);
    if (!folder) {
      waiting.push(root.path);
      continue;
    }
    const stage = path.join(context, 'roots', root.id);
    // Only .claude and CLAUDE.md are ever written into a project folder. In a clone made just now, the backup's latest edit wins.
    const mode = isBelow(folder, fresh) ? 'replace' : 'keep';
    mergeInto(path.join(stage, '.claude'), path.join(folder, '.claude'), total, mode);
    if (fs.existsSync(path.join(stage, 'CLAUDE.md'))) {
      const notes = path.join(stage, 'notes');
      fs.mkdirSync(notes);
      fs.renameSync(path.join(stage, 'CLAUDE.md'), path.join(notes, 'CLAUDE.md'));
      importFolder(notes, folder, total, mode);
    }
    placed++;
  }
  bar.end();
  log(say('ok', `Project .claude folders (${placed}): ${total.copied} copied, ${total.updated} brought up to date, ${total.skipped} already there, ${total.kept} kept beside a changed copy`));
  const noPlace = [...new Set(waiting)];
  if (noPlace.length > 0) {
    log(say('warn', `${noPlace.length} folders have no place on this machine. Run this again with --map <old>=<new>:`));
    for (const folder of noPlace.slice(0, 10)) log(`  ${folder}`);
    if (noPlace.length > 10) log(`  and ${noPlace.length - 10} more`);
  }
  if ((saved.plugins ?? []).length > 0) {
    log(say('info', 'Plugins are installed from their marketplaces, not from a backup. Those you had:'));
    for (const plugin of saved.plugins) log(`  claude plugin install ${plugin}`);
  }
}

// Ships merged in, missing members re-created without a login, project folders renamed to this machine's paths.
export async function restore(config: Config, zip: string, options: RestoreOptions, log: (line: string) => void = console.log): Promise<string[]> {
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
      await runTar(tar, ['-x', '-f', file, '-C', extract, ...(options.password ? ['--passphrase', options.password] : [])], 'Unpacking', zipEntryCount(file));
    } catch (error) {
      if (/passphrase/i.test((error as Error).message)) throw new Error(options.password ? `The password does not open ${zip}.` : `${zip} is encrypted. Add --password.`);
      throw error;
    }
    const links = findLinks(extract);
    if (links.length > 0) throw new Error(`The backup holds a link (${path.relative(extract, links[0])}), so crewrota restored nothing from it.`);
    const manifest = readJson(path.join(extract, 'manifest.json')) as Manifest | null;
    if (!manifest) throw new Error(`${zip} is not a crewrota backup: it has no manifest.json.`);
    if (manifest.format !== 1 && manifest.format !== 2) throw new Error(`${zip} has backup format ${manifest.format}; this crewrota reads formats 1 and 2. Update crewrota and try again.`);
    if (manifest.renamed) restoreNames(extract, manifest.renamed);

    const extractShips = path.join(extract, 'ships');
    const ships = shipFolders(extractShips);
    const members = Object.entries(manifest.members ?? {});
    for (const ship of ships) checkName('ship', ship);
    for (const [name, member] of members) {
      checkName('crew member', name);
      if (member.ship) checkName('ship', member.ship);
    }

    const bare = (folder: string) => folder.replace(/[\\/]+$/, ''); // E:\ and E: are the same map
    const remaps: [string, string][] = options.maps.map(([from, to]) => [projectSlug(bare(from)), projectSlug(bare(to))]);
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

    if (manifest.context) restoreContext(manifest, path.join(extract, 'context'), options, log);

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
