import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Config } from './config.js';
import { lstatOrNull } from './links.js';
import { mainClaudeDir, mainClaudeJson, memberDir, samePath, shipsDir } from './paths.js';

export interface Repo {
  path: string;
  remote?: string;
  branch?: string;
  commit?: string;
  changed: number; // -1 when git could not say in time
  unpushed: number; // -1 when git could not say in time
}

export interface SecretHit {
  file: string;
  rule: string;
}

export interface CopyStats {
  files: number;
  bytes: number;
  left: string[];
  withheld: string[];
  folders: Map<string, number>;
  secrets: SecretHit[];
  quick?: boolean; // sizes only, no key check: the pass that sets the progress bar's total
  onFile?: (bytes: number) => void;
}

const SKIP_FOLDERS = new Set(['node_modules', '.git', 'worktrees', '.worktrees', '__pycache__', '.venv', 'venv', '.next', '.trash']);
const SKIP_FILES = [
  /^\.credentials/,
  /^\.env$/,
  /^\.env\.(?!example$|sample$|template$)/,
  /^\.(netrc|htpasswd|npmrc)$/,
  /^id_(rsa|dsa|ecdsa|ed25519)/,
  /\.(pem|key|p12|pfx|pkcs12|ppk|keystore|jks|ovpn|kdb|keychain)$/i,
  /^settings\.local\.json$/,
];
const MACHINE_FILES = [/\.lock$/, /^crewrota-backup-\d{8}-\d{4}\.zip$/];
const SCAN_SKIP = new Set(['node_modules', '.git', '.worktrees', '.claude', '__pycache__', '.venv', 'venv', '.next', 'dist', 'build', '.trash']);
const SCAN_DEPTH = 6;
const SCAN_FILE_LIMIT = 1024 * 1024;
const GIT_READ_LIMIT = 20_000;

// Shapes from the gitleaks rule set that real keys carry, so a hit is rarely a false alarm.
const SECRET_RULES: [string, RegExp][] = [
  ['private key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['AWS key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['Anthropic key', /\bsk-ant-(?:api03|admin01)-[A-Za-z0-9_-]{32,}/],
  ['OpenAI key', /\bsk-[A-Za-z0-9_-]{20,}T3BlbkFJ/],
  ['Slack token', /\b(?:xox[bpe]-[A-Za-z0-9-]{20,}|xapp-\d-[A-Za-z0-9-]{20,})/],
  ['Stripe live key', /\b[rs]k_live_[A-Za-z0-9]{20,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['Google API key', /\bAIza[A-Za-z0-9_-]{35}\b/],
];

export function emptyStats(): CopyStats {
  return { files: 0, bytes: 0, left: [], withheld: [], folders: new Map(), secrets: [] };
}

// A read must never wait: a partial clone can start a fetch that sits on a login prompt.
function git(dir: string, args: string[]): string | null {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GCM_INTERACTIVE: 'never' };
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true, timeout: GIT_READ_LIMIT, maxBuffer: 1 << 28, env });
  return result.status === 0 ? result.stdout.trim() : null;
}

function isFolder(file: string): boolean {
  return fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function folderEntries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// The first working folder a transcript names; a session's first lines carry it.
export function transcriptFolder(file: string): string | null {
  const head = Buffer.alloc(256 * 1024);
  let length = 0;
  const handle = fs.openSync(file, 'r');
  try {
    length = fs.readSync(handle, head, 0, head.length, 0);
  } finally {
    fs.closeSync(handle);
  }
  for (const line of head.toString('utf8', 0, length).split('\n')) {
    if (!line.includes('"cwd"')) continue;
    try {
      const cwd = JSON.parse(line).cwd;
      if (typeof cwd === 'string' && cwd) return cwd;
    } catch {
      continue; // the last line may be cut off at the read limit
    }
  }
  return null;
}

function foldersInProjects(dir: string, found: Set<string>): void {
  for (const project of folderEntries(dir)) {
    if (!project.isDirectory()) continue;
    const folder = path.join(dir, project.name);
    for (const file of folderEntries(folder)) {
      if (!file.name.endsWith('.jsonl')) continue;
      const cwd = transcriptFolder(path.join(folder, file.name));
      if (cwd) {
        found.add(cwd);
        break;
      }
    }
  }
}

function foldersInClaudeJson(file: string, found: Set<string>): void {
  if (!fs.existsSync(file)) return;
  try {
    const projects = JSON.parse(fs.readFileSync(file, 'utf8')).projects;
    if (projects && typeof projects === 'object') for (const folder of Object.keys(projects)) found.add(path.resolve(folder));
  } catch {
    return;
  }
}

// Every folder Claude Code has worked in, from each transcript and each .claude.json. No disk-wide search.
export function knownFolders(config: Config): string[] {
  const found = new Set<string>();
  for (const ship of folderEntries(shipsDir())) {
    if (ship.isDirectory()) foldersInProjects(path.join(shipsDir(), ship.name, 'projects'), found);
  }
  foldersInProjects(path.join(mainClaudeDir(), 'projects'), found);
  foldersInClaudeJson(mainClaudeJson(), found);
  for (const name of Object.keys(config.members)) {
    foldersInClaudeJson(path.join(memberDir(name), '.claude.json'), found);
    const own = path.join(memberDir(name), 'projects');
    if (lstatOrNull(own)?.isDirectory()) foldersInProjects(own, found);
  }
  return [...new Set([...found].filter(isFolder).map(realFolder))].sort();
}

// The long, true form of a path, so a short Windows name or a link cannot make one folder look like two.
function realFolder(folder: string): string {
  try {
    return fs.realpathSync.native(folder);
  } catch {
    return path.resolve(folder);
  }
}

// A Claude config folder (the main ~/.claude, someone else's) has transcripts beside its history or plugins; a project's does not.
function isConfigFolder(claude: string): boolean {
  if (samePath(realFolder(claude), realFolder(mainClaudeDir()))) return true;
  return fs.existsSync(path.join(claude, 'projects')) && ['history.jsonl', 'plugins', '.credentials.json'].some((name) => fs.existsSync(path.join(claude, name)));
}

export function isLinkedWorktree(folder: string): boolean {
  const marker = path.join(folder, '.git');
  if (!lstatOrNull(marker)?.isFile()) return false;
  return /[\\/]worktrees[\\/]/.test(fs.readFileSync(marker, 'utf8'));
}

function inside(file: string, folders: string[]): boolean {
  return folders.some((folder) => {
    const relative = path.relative(folder, file);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}

// Folders that hold a .claude: every known folder and its parents, then below the top-most ones.
export function findRoots(folders: string[], skip: string[] = []): string[] {
  const roots = new Set<string>();
  const add = (folder: string) => {
    const claude = path.join(folder, '.claude');
    if (!lstatOrNull(claude)?.isDirectory() || inside(folder, skip) || isConfigFolder(claude) || isLinkedWorktree(folder)) return false;
    roots.add(path.resolve(folder));
    return true;
  };
  const anchors = new Set<string>();
  for (const start of folders) {
    let top: string | null = null;
    for (let folder = start; ; folder = path.dirname(folder)) {
      if (add(folder)) top = folder;
      if (folder === path.dirname(folder)) break;
    }
    if (top) anchors.add(path.resolve(top));
    else {
      const repo = repoTop(start); // a project with its .claude further down; a temp or plain folder is not worth walking
      if (repo && !inside(os.homedir(), [repo])) anchors.add(repo);
    }
  }
  const seen = new Set<string>();
  const walk = (folder: string, depth: number) => {
    if (seen.has(folder) || inside(folder, skip)) return;
    seen.add(folder);
    add(folder);
    if (depth === 0) return;
    for (const entry of folderEntries(folder)) {
      if (entry.isDirectory() && !SCAN_SKIP.has(entry.name)) walk(path.join(folder, entry.name), depth - 1);
    }
  };
  for (const anchor of anchors) walk(anchor, SCAN_DEPTH);
  return [...roots].sort();
}

// An ssh user name such as git@ is part of the address; a password never is.
function withoutLogin(remote: string): string {
  return remote.replace(/^(https?:\/\/)[^/@]+@/i, '$1').replace(/^([a-z][a-z0-9+.-]*:\/\/[^/:@]+):[^/@]+@/i, '$1@');
}

// The checkout a folder belongs to, a linked worktree counted as its main checkout.
function repoTop(folder: string): string | null {
  const common = git(folder, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) return null;
  const top = path.resolve(common);
  return path.basename(top) === '.git' ? path.dirname(top) : null;
}

// Where each known project's code comes from, and what the remote does not have yet.
export function findRepos(folders: string[], skip: string[] = [], step: (done: number, total: number) => void = () => {}): Repo[] {
  const tops = new Set<string>();
  for (const folder of folders) {
    const top = repoTop(folder);
    if (top && !inside(top, skip)) tops.add(top);
  }
  const sorted = [...tops].sort();
  return sorted.map((top, index) => {
    step(index, sorted.length);
    const remote = git(top, ['remote', 'get-url', 'origin']);
    const branch = git(top, ['branch', '--show-current']);
    const commit = git(top, ['rev-parse', 'HEAD']);
    const status = git(top, ['status', '--porcelain', '--', '.', ':(exclude,glob)**/.claude/**', ':(exclude,glob)**/CLAUDE.md']); // the backup carries those itself
    const unpushed = git(top, ['rev-list', '--count', '--branches', '--not', '--remotes']);
    return {
      path: top,
      ...(remote ? { remote: withoutLogin(remote) } : {}),
      ...(branch ? { branch } : {}),
      ...(commit ? { commit } : {}),
      changed: status === null ? -1 : status ? status.split('\n').length : 0,
      unpushed: unpushed === null ? -1 : Number(unpushed),
    };
  });
}

function scanSecrets(file: string, size: number, shown: string, stats: CopyStats): void {
  if (size > SCAN_FILE_LIMIT) return;
  const data = fs.readFileSync(file);
  if (data.subarray(0, 8000).includes(0)) return;
  const text = data.toString('utf8');
  for (const [rule, pattern] of SECRET_RULES) {
    if (pattern.test(text)) stats.secrets.push({ file: shown, rule });
  }
}

// Sizes add up per task folder, or per .claude for anything outside tasks/.
function bucketOf(file: string): string {
  const match = file.match(/^(.*?[\\/]\.claude[\\/]tasks[\\/][^\\/]+)[\\/]/) ?? file.match(/^(.*?[\\/]\.claude)[\\/]/);
  return match ? match[1] : path.dirname(file);
}

// Copies a tree with links resolved, leaving out logins and machine-local files. With no target it only measures.
export function copyTree(from: string, to: string | null, stats: CopyStats, skip: string[] = [], shown = from, seen = new Set<string>()): void {
  let real: string;
  try {
    real = fs.realpathSync.native(from);
  } catch {
    stats.left.push(shown);
    return;
  }
  if (seen.has(real) || inside(real, skip)) return;
  seen.add(real);
  if (to) fs.mkdirSync(to, { recursive: true });
  for (const entry of folderEntries(real)) {
    const source = path.join(real, entry.name);
    const target = to ? path.join(to, entry.name) : null;
    const label = path.join(shown, entry.name);
    const stat = fs.statSync(source, { throwIfNoEntry: false });
    if (!stat) {
      stats.left.push(label);
    } else if (stat.isDirectory()) {
      if (SKIP_FOLDERS.has(entry.name)) continue;
      copyTree(source, target, stats, skip, label, new Set(seen));
    } else if (stat.isFile()) {
      if (MACHINE_FILES.some((pattern) => pattern.test(entry.name))) continue;
      if (SKIP_FILES.some((pattern) => pattern.test(entry.name))) {
        stats.withheld.push(label);
        continue;
      }
      try {
        if (!stats.quick) scanSecrets(source, stat.size, label, stats);
        if (target) fs.copyFileSync(source, target);
      } catch {
        stats.left.push(label); // locked by a running program, or unreadable; one file must not stop the backup
        continue;
      }
      stats.files++;
      stats.bytes += stat.size;
      const bucket = bucketOf(label);
      stats.folders.set(bucket, (stats.folders.get(bucket) ?? 0) + stat.size);
      stats.onFile?.(stat.size);
    }
  }
}

// A skill is a folder with a SKILL.md at its top; .trash, synced and stray folders are not.
export function skillNames(dir: string): string[] {
  return folderEntries(dir)
    .filter((entry) => fs.existsSync(path.join(dir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

export function installedPlugins(): string[] {
  const file = path.join(mainClaudeDir(), 'plugins', 'installed_plugins.json');
  if (!fs.existsSync(file)) return [];
  try {
    return Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).plugins ?? {}).sort();
  } catch {
    return [];
  }
}

// A saved folder on this machine: longest --map first, then the old home folder. Null when it has no place here.
export function mapFolder(folder: string, maps: [string, string][], platform: string, home?: string): string | null {
  const windows = platform === 'win32';
  const separators = windows ? /[\\/]+/g : /\/+/g;
  const clean = (value: string) => {
    const normal = value.replace(separators, '/');
    return normal.length > 1 ? normal.replace(/\/$/, '') : normal;
  };
  const key = (value: string) => (windows ? value.toLowerCase() : value);
  const from = clean(folder);
  const all: [string, string][] = [...maps, ...(home ? ([[home, os.homedir()]] as [string, string][]) : [])];
  const match = all
    .map(([old, now]) => [clean(old), now] as [string, string])
    .sort((a, b) => b[0].length - a[0].length)
    .find(([old]) => key(from) === key(old) || key(from).startsWith(`${key(old)}/`) || (old.endsWith('/') && key(from).startsWith(key(old))));
  const mapped = match ? path.join(match[1], from.slice(match[0].length)) : from.split('/').join(path.sep);
  if (!path.isAbsolute(mapped)) return null;
  return fs.existsSync(path.parse(mapped).root) ? path.resolve(mapped) : null;
}

function run(file: string, args: string[], cwd?: string): boolean {
  return spawnSync(file, args, { cwd, stdio: 'inherit', windowsHide: true }).status === 0;
}

// True when a folder holds nothing a restore did not write: only .claude and CLAUDE.md, at any depth.
function onlyContext(folder: string): boolean {
  return folderEntries(folder).every((entry) => {
    if (entry.name === '.claude' || entry.name === 'CLAUDE.md') return true;
    return entry.isDirectory() && !entry.isSymbolicLink() && onlyContext(path.join(folder, entry.name));
  });
}

// git clone needs an empty folder, so what a restore already put there waits beside it and comes back by the given merge.
export function cloneRepo(remote: string, folder: string, branch: string | undefined, merge: (from: string, to: string) => void): 'cloned' | 'failed' | 'in-the-way' | 'here' {
  if (fs.existsSync(path.join(folder, '.git'))) return 'here';
  if (remote.startsWith('-')) return 'failed';
  const waiting = isFolder(folder) ? fs.readdirSync(folder) : [];
  if (isFolder(folder) && !onlyContext(folder)) return 'in-the-way';
  const aside = `${folder}.crew-restore`;
  if (lstatOrNull(aside)) return 'in-the-way';
  if (waiting.length > 0) {
    fs.mkdirSync(aside);
    for (const name of waiting) fs.renameSync(path.join(folder, name), path.join(aside, name));
  }
  fs.mkdirSync(path.dirname(folder), { recursive: true });
  const ok = run('git', ['clone', ...(branch ? ['--branch', branch] : []), '--', remote, folder]);
  if (waiting.length > 0) {
    fs.mkdirSync(folder, { recursive: true });
    merge(aside, folder);
    fs.rmSync(aside, { recursive: true, force: true }); // made above, holds only what merge just copied
  }
  return ok ? 'cloned' : 'failed';
}
