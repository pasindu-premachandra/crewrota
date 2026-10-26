import fs from 'node:fs';
import path from 'node:path';
import { type LinkState, freePath, linkState, lstatOrNull, makeDirLink, renameFolder, stamp } from './links.js';
import { mainClaudeDir, mainClaudeJson } from './paths.js';

export const LINKED_ITEMS = ['skills', 'agents', 'commands'];
export const COPIED_FILES = ['settings.json', 'CLAUDE.md'];
const PLUGIN_LINKS = ['cache', 'data', 'marketplaces'];
const PLUGIN_COPIES = ['installed_plugins.json', 'blocklist.json', 'install-counts-cache.json'];

function isFolder(file: string): boolean {
  return fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function readJson(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${(error as Error).message}). Nothing launched.`);
  }
}

// crewrota only writes a member's own files, never through a link.
function refuseLink(file: string): void {
  if (lstatOrNull(file)?.isSymbolicLink()) {
    throw new Error(`${file} is a link, and crewrota only writes a member's own files. Remove the link and launch again.`);
  }
}

export function sharedLinkStates(dir: string): { link: string; source: string; state: LinkState }[] {
  return LINKED_ITEMS.map((name) => ({ link: path.join(dir, name), source: path.join(mainClaudeDir(), name) }))
    .filter(({ source }) => isFolder(source))
    .map((item) => ({ ...item, state: linkState(item.link, item.source) }));
}

function linkItem(link: string, source: string, state: LinkState): void {
  if (state === 'ok') return;
  if (state === 'dangling' || state === 'elsewhere') fs.unlinkSync(link);
  if (state === 'not-a-link') {
    const stat = fs.lstatSync(link);
    if (!stat.isDirectory() || fs.readdirSync(link).length > 0) {
      throw new Error(`${link} is in the way of the link to ${source}. Move it somewhere else and launch again. Nothing launched.`);
    }
    fs.rmdirSync(link);
  }
  try {
    makeDirLink(source, link);
  } catch (error) {
    throw new Error(`Could not link ${link} to ${source}: ${(error as Error).message}. Nothing launched.`);
  }
}

export function mainMcpServers(): Record<string, unknown> | undefined {
  return readJson(mainClaudeJson())?.mcpServers as Record<string, unknown> | undefined;
}

function copyMcpServers(dir: string, servers: Record<string, unknown> | undefined): void {
  if (servers === undefined) return;
  const file = path.join(dir, '.claude.json');
  refuseLink(file);
  const member = readJson(file) ?? {};
  if (JSON.stringify(member.mcpServers) === JSON.stringify(servers)) return;
  member.mcpServers = servers;
  fs.writeFileSync(file, JSON.stringify(member, null, 2));
}

// The member's own plugins/ folder, laid out as ccs lays out a seat's: the shared folders linked, the lists copied,
// and known_marketplaces.json copied with its install paths pointed at this member's folder.
function syncPlugins(dir: string, now = new Date()): string[] {
  const source = path.join(mainClaudeDir(), 'plugins');
  if (!isFolder(source)) return [];
  const notes: string[] = [];
  const target = path.join(dir, 'plugins');
  refuseLink(target);
  if (PLUGIN_LINKS.some((name) => linkState(path.join(target, name), path.join(source, name)) === 'not-a-link')) {
    const base = path.join(dir, `plugins.before-crewrota-${stamp(now, false)}`);
    const aside = freePath((n) => (n === 0 ? base : `${base}-${n + 1}`));
    renameFolder(target, aside);
    notes.push(`This member now uses your main plugins. Its own plugins folder is kept at ${aside}`);
  }
  fs.mkdirSync(target, { recursive: true });
  for (const name of PLUGIN_LINKS) {
    const from = path.join(source, name);
    if (isFolder(from)) linkItem(path.join(target, name), from, linkState(path.join(target, name), from));
  }
  for (const name of PLUGIN_COPIES) {
    const from = path.join(source, name);
    if (!fs.existsSync(from)) continue;
    refuseLink(path.join(target, name));
    fs.copyFileSync(from, path.join(target, name));
  }
  const known = readJson(path.join(source, 'known_marketplaces.json'));
  if (known) {
    for (const entry of Object.values(known)) {
      const location = (entry as { installLocation?: unknown })?.installLocation;
      if (typeof location !== 'string') continue;
      const inside = path.relative(source, location);
      if (!inside.startsWith('..') && !path.isAbsolute(inside)) (entry as { installLocation: string }).installLocation = path.join(target, inside);
    }
    refuseLink(path.join(target, 'known_marketplaces.json'));
    fs.writeFileSync(path.join(target, 'known_marketplaces.json'), JSON.stringify(known, null, 2));
  }
  return notes;
}

// Read-only on the main side: links point at ~/.claude, files and the given MCP servers are copied one way into the member.
export function syncSharedItems(dir: string, servers: Record<string, unknown> | undefined): string[] {
  for (const { link, source, state } of sharedLinkStates(dir)) linkItem(link, source, state);
  const notes = syncPlugins(dir);
  for (const name of COPIED_FILES) {
    const source = path.join(mainClaudeDir(), name);
    if (!fs.existsSync(source)) continue;
    const target = path.join(dir, name);
    refuseLink(target);
    fs.copyFileSync(source, target);
  }
  copyMcpServers(dir, servers);
  return notes;
}
