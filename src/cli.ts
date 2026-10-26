#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isAccessible } from '@clack/core';
import { cancel, intro, outro } from '@clack/prompts';
import { type RateLimits, authStatus, probeRateLimits, readRateLimits, startClaude } from './claude.js';
import { type Choice, type Config, loadConfig, rememberedChoice, saveConfig } from './config.js';
import { runDoctor } from './doctor.js';
import { organizationLabel, readIdentity } from './identity.js';
import { initProject } from './init.js';
import { launch } from './launch.js';
import { countSessionFiles, moveToRemoved } from './links.js';
import { addMember, createMember, loginArgs, memberOrThrow, realDeps, removalImpact, removeMember, renameMember, useMember } from './members.js';
import { ADD_MEMBER, ISOLATED, TYPE_A_NAME, askMemberName, askModelName, askSkipPermissions, askYesNo, crewMenu, menubarLines, pickChoice, pickMember, quotaLines } from './menu.js';
import { checkName } from './names.js';
import { configFile, crewHome, memberDir, packageRoot, removedDir, shipDir, shipProjectsDir } from './paths.js';
import { formatRows, memberRows } from './rows.js';
import { paint, paintError, say } from './say.js';
import { realSetupRunner, runSetup, toolChecks } from './setup.js';
import {
  SHIP_FOLDERS,
  createShip,
  importIntoShip,
  joinShip,
  leaveShip,
  listShips,
  readShipMcp,
  renameShip,
  shipExists,
  shipMcpFile,
  shipMembers,
  writeShipMcp,
} from './ships.js';
import { statusText, writeQuota } from './statusline.js';
import { closeWidget, openWidget, setStartup } from './widget.js';

const HELP = `crewrota - run Claude Code as one of your crew members: one Claude login each, in its own folder.
A ship holds the history, memory, session folders and MCP servers that several members share; every member
gets your main setup's skills, agents, commands and plugins. crw and crew are the same command.

Usage:
  crew                                         menu: pick a member, ship, model and effort, then launch Claude
  crew use <member>                            make <member> the current one (offers to create it if missing)
  crew use -                                   go back to the previous member
  crew add <member> [--ship <s>] [--email <e>] [--sso]
                                               create a member and log it in with Claude Code's own login
  crew run [<member>] [-- <claude args>]       launch Claude as <member>, else $CREW_MEMBER, else the current one
  crew <member> [-- <claude args>]             the same as crew run <member>: its saved model, effort and ship
  crew list | crew ls                          members with ship, usage, email and organisation
  crew whoami                                  the current member in detail
  crew quota                                   every member's 5-hour and week use as bars
  crew quota --format menubar                  the same for a SwiftBar or xbar menu bar item (macOS, beta); never checks usage
  crew warmup [<member>...]                    send each member one short message (Haiku), which starts its 5-hour
                                               window if none is running, then show the bars
  crew widget                                  open the quota widget: every member's bars on your desktop
  crew widget close                            close it
  crew widget startup on|off                   open the widget at login, or stop that (Windows)
  crew current                                 the current member's name only
  crew login <member> | crew logout <member>   log a member in or out; its folder stays
  crew rename <old> <new>                      rename a member
  crew drop <member> [--force] [--yes]         drop a member: its folder moves to removed/ (crew remove works too)
  crew ship create <ship>                      make an empty ship
  crew ship list                               ships and their members
  crew ship rename <old> <new>                 rename a ship and re-point its members
  crew ship delete <ship> [--force] [--yes]    move a ship's folder to removed/
  crew ship join <member> <ship>               share <member>'s history through <ship>
  crew ship leave <member>                     make <member> isolated again (the ship keeps its files)
  crew ship mcp list <ship>                    the ship's MCP servers (its members get them at launch)
  crew ship mcp add <ship> <name> --url <url> [--header "Name: value"]
  crew ship mcp add <ship> <name> [--env KEY=value] -- <command> [args]
                                               add an MCP server to the ship; keys stay in the ship's own mcp.json
  crew ship mcp add <ship> <name> --from <.claude.json>
                                               copy one server's definition from another config file
  crew ship mcp remove <ship> <name>           remove one
  crew ship import <ship> --from <folder>      copy history, memory and session folders into the ship (a ccs context
                                               group folder works); run it again to add what is new
  crew config permissions on|off               start sessions with --dangerously-skip-permissions or not
  crew config refresh on|off                   read every member's usage with quota-axi as the menu opens (no message; on by default)
  crew config lavish on|off                    add the plugin's Lavish rule at every session start, or stop that (on by default)
  crew config show                             remembered settings
  crew setup [--yes] [--with-hooks]            install the default tools from upstream: one list, one yes; installed ones are skipped
  crew init                                    write the project's .claude/ folder here; never overwrites a file
  crew doctor [--logins]                       check the setup and the default tools
  crew statusline                              the status line crewrota gives members without one (saves quota.json)
  crew --help | --version

Names use lowercase letters, digits and hyphens, start with a letter, and are at most 32 characters.
Arguments after -- go to Claude, after crewrota's own flags.
`;

// Commands in amber and what they do faint; plain when piped.
function styledHelp(): string {
  return HELP.split('\n')
    .map((line) => {
      if (line === 'Usage:') return paint('text', line, true);
      const parts = /^(\s+)(\S.*?)(?:(\s{2,})(.*))?$/.exec(line);
      if (!parts) return line;
      const [, indent, first, gap, about] = parts;
      if (indent.length > 2) return `${indent}${paint('faint', first)}`;
      return `${indent}${paint('amber', first)}${gap ? `${gap}${paint('faint', about)}` : ''}`;
    })
    .join('\n');
}

function version(): string {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
}

function interactive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function needTerminal(what: string, instead: string): void {
  if (!interactive()) throw new Error(`${what} needs a terminal. ${instead}`);
}

function usage(text: string): never {
  throw new Error(`Usage: ${text}`);
}

// Value flags take the next argument; anything else starting with - (but "-" itself) is unknown.
function parseArgs(args: string[], valueFlags: string[] = [], boolFlags: string[] = []) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (valueFlags.includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('-')) throw new Error(`${arg} needs a value.`);
      flags[arg] = value;
    } else if (boolFlags.includes(arg)) {
      flags[arg] = true;
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function stringFlag(value: string | true | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function startLaunch(member: string, choice: Choice, extra: string[], config: Config): Promise<number> {
  if (config.skipPermissions === null && !interactive()) {
    console.error('crewrota asks once whether to use --dangerously-skip-permissions, and that needs a terminal.');
    console.error('Answer it now with: crew config permissions on   (or off)');
    return 1;
  }
  const code = await launch(member, choice, extra, config, { askSkipPermissions: () => askSkipPermissions(), start: startClaude });
  if (code === null) {
    cancel('Nothing launched.');
    return 0;
  }
  return code;
}

interface Launch {
  member: string;
  choice: Choice;
  ship: string; // a ship name or ISOLATED
}

// A member whose reading fails keeps its last one.
async function saveReadings(names: string[], read: (dir: string) => Promise<RateLimits | null>): Promise<void> {
  await Promise.all(
    names.map(async (name) => {
      const limits = await read(memberDir(name));
      try {
        if (limits) writeQuota(memberDir(name), { rate_limits: limits });
      } catch {
        // the menu still opens with the last reading
      }
    }),
  );
}

// Reads every member's usage with quota-axi as the menu opens, side by side; off with crew config refresh off.
async function refreshReadings(config: Config): Promise<void> {
  const names = Object.keys(config.members);
  const who = names.length === 1 ? names[0] : `${names.length} members`;
  const terminal = Boolean(process.stdout.isTTY);
  if (terminal) {
    process.stdout.write(
      `${paint('text', `Checking usage for ${who}`)} ${paint('faint', '(crewrota reads each member\'s usage; stop it with:')} ${paint('amber', 'crew config refresh off', true)}${paint('faint', ')...')}`,
    );
  }
  await saveReadings(names, readRateLimits);
  if (terminal) process.stdout.write('\r\x1b[2K');
}

async function quota(args: string[]): Promise<number> {
  const menubar = args.length === 2 && args[0] === '--format' && args[1] === 'menubar';
  if (args.length > 0 && !menubar) usage('crew quota [--format menubar]');
  const config = loadConfig();
  // SwiftBar runs it every minute, so it only reads quota.json and never checks usage.
  if (menubar) {
    console.log(menubarLines(config).join('\n'));
    return 0;
  }
  if (Object.keys(config.members).length === 0) {
    console.log('No crew members yet. Add one with: crew add <member>');
    return 0;
  }
  if (config.refreshReadings !== false) await refreshReadings(config);
  console.log(quotaLines(config, process.stdout).join('\n'));
  return 0;
}

// Opt-in: the one command that sends messages, to start the 5-hour windows of idle members.
async function warmup(args: string[]): Promise<number> {
  const { positional } = parseArgs(args);
  const config = loadConfig();
  if (Object.keys(config.members).length === 0) {
    console.log('No crew members yet. Add one with: crew add <member>');
    return 0;
  }
  for (const name of positional) memberOrThrow(config, name);
  console.log(say('info', 'Each member gets one short message (Haiku), which starts its 5-hour window if none is running.'));
  await saveReadings(positional.length > 0 ? positional : Object.keys(config.members), probeRateLimits);
  console.log(quotaLines(config, process.stdout).join('\n'));
  return 0;
}

async function widget(args: string[]): Promise<number> {
  const [action, value, ...extra] = args;
  if (action === undefined) {
    if (openWidget() === 'already') console.log(say('info', 'The widget is already open. Close it with: crew widget close'));
    else console.log(say('ok', 'The widget is open. Right-click it to warm up, refresh or quit; close it with: crew widget close'));
    return 0;
  }
  if (action === 'close' && value === undefined) {
    const result = await closeWidget();
    if (result === 'closed') console.log(say('ok', 'Closed the widget.'));
    else if (result === 'not-open') console.log(say('info', 'The widget is not open.'));
    else console.log(say('warn', 'The widget did not close within 5 seconds. Right-click it and pick Quit.'));
    return result === 'still-open' ? 1 : 0;
  }
  if (action === 'startup' && (value === 'on' || value === 'off') && extra.length === 0) {
    const link = setStartup(value === 'on');
    console.log(value === 'on' ? say('ok', `The widget opens at login, from ${link}`) : say('ok', 'The widget no longer opens at login.'));
    return 0;
  }
  usage('crew widget | crew widget close | crew widget startup on|off');
}

// The one-screen menu once there are members; step by step with none, and for screen readers (ACCESSIBLE).
async function pickLaunch(config: Config): Promise<Launch | null> {
  let member: string | null;
  if (Object.keys(config.members).length > 0 && !isAccessible()) {
    const pick = await crewMenu(config);
    if (pick === null) return null;
    if (pick !== ADD_MEMBER) {
      if (pick.choice.model !== TYPE_A_NAME) return pick;
      const model = await askModelName();
      return model === null ? null : { ...pick, choice: { ...pick.choice, model } };
    }
    member = ADD_MEMBER;
  } else {
    intro('crewrota');
    member = await pickMember(config);
  }
  if (member === ADD_MEMBER) {
    const name = await askMemberName(config);
    member = name !== null && (await createMember(config, name, {}, realDeps, 'if-none')) ? name : null;
  }
  if (member === null) return null;
  const choice = await pickChoice(config, member);
  return choice ? { member, choice, ship: config.members[member].ship ?? ISOLATED } : null;
}

async function menu(): Promise<number> {
  if (!interactive()) {
    console.error('The menu needs a terminal. Without one, use: crew run <member>');
    return 1;
  }
  const config = loadConfig();
  if (config.refreshReadings !== false && Object.keys(config.members).length > 0 && !isAccessible()) await refreshReadings(config);
  const picked = await pickLaunch(config);
  if (!picked) {
    cancel('Nothing launched.');
    return 0;
  }
  const { member, choice, ship } = picked;
  if (config.skipPermissions === null) {
    const answer = await askSkipPermissions();
    if (answer === null) {
      cancel('Nothing launched.');
      return 0;
    }
    config.skipPermissions = answer; // saved by launch only once claude starts
  }
  if (ship !== (config.members[member].ship ?? ISOLATED)) {
    const notes = ship === ISOLATED ? leaveShip(config, member) : joinShip(config, member, ship);
    saveConfig(config);
    for (const note of notes) console.log(say('info', note));
  }
  outro(`Launching Claude as ${member}`);
  return startLaunch(member, choice, [], config);
}

async function use(args: string[]): Promise<number> {
  const { positional } = parseArgs(args);
  if (positional.length !== 1) usage('crew use <member> | crew use -');
  const [member] = positional;
  const config = loadConfig();
  if (member !== '-' && !config.members[member]) {
    checkName('crew member', member);
    needTerminal(`Crew member ${member} doesn't exist. Creating it`, `Run crew add ${member} in a terminal.`);
  }
  if (!(await useMember(config, member))) console.log('Nothing created.');
  return 0;
}

async function add(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args, ['--ship', '--email'], ['--sso']);
  if (positional.length !== 1) usage('crew add <member> [--ship <s>] [--email <e>] [--sso]');
  const [member] = positional;
  const options = { ship: stringFlag(flags['--ship']), email: stringFlag(flags['--email']), sso: flags['--sso'] === true };
  const config = loadConfig();
  checkName('crew member', member);
  if (options.ship) checkName('ship', options.ship);
  if (config.members[member]) throw new Error(`Crew member ${member} already exists`);
  needTerminal('Adding a crew member', "It runs Claude Code's own login.");
  if (!(await addMember(config, member, options))) console.log('Nothing created.');
  return 0;
}

async function run(args: string[]): Promise<number> {
  const dash = args.indexOf('--');
  const { positional } = parseArgs(dash === -1 ? args : args.slice(0, dash));
  if (positional.length > 1) usage('crew run [<member>] [-- <claude args>]');
  const config = loadConfig();
  const member = positional[0] || process.env.CREW_MEMBER || config.current;
  if (!member) throw new Error('No crew member chosen. Pick one with: crew use <member>');
  memberOrThrow(config, member);
  return startLaunch(member, rememberedChoice(config, member), dash === -1 ? [] : args.slice(dash + 1), config);
}

function list(): number {
  const rows = memberRows(loadConfig());
  if (rows.length === 0) {
    console.log('No crew members yet. Add one with: crew add <member>');
    return 0;
  }
  for (const line of formatRows(rows, true, paint)) console.log(line);
  return 0;
}

function whoami(): number {
  const config = loadConfig();
  const member = config.current;
  if (!member || !config.members[member]) throw new Error('No current crew member. Pick one with: crew use <member>');
  const dir = memberDir(member);
  const identity = readIdentity(dir);
  const status = fs.existsSync(dir) ? authStatus(dir) : { loggedIn: false, problem: 'its folder is missing' };
  const line = (label: string, value: string) => console.log(`${paint('faint', label.padEnd(14))}${value}`);
  line('Crew member:', paint('text', member, true));
  line('Folder:', dir);
  line('Ship:', config.members[member].ship ?? 'isolated');
  line('Email:', identity?.email ?? 'unknown');
  line('Organisation:', identity ? organizationLabel(identity) : 'unknown');
  line('Logged in:', `${status.loggedIn ? paint('green', 'yes') : paint('red', 'no')}${status.problem ? ` (${status.problem})` : ''}`);
  return 0;
}

function current(): number {
  const config = loadConfig();
  if (!config.current || !config.members[config.current]) return 1;
  console.log(config.current);
  return 0;
}

async function auth(action: 'login' | 'logout', args: string[]): Promise<number> {
  const { positional, flags } = action === 'login' ? parseArgs(args, ['--email'], ['--sso']) : parseArgs(args);
  if (positional.length !== 1) usage(action === 'login' ? 'crew login <member> [--email <e>] [--sso]' : 'crew logout <member>');
  const [member] = positional;
  memberOrThrow(loadConfig(), member);
  const dir = memberDir(member);
  if (action === 'login') fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  else if (!fs.existsSync(dir)) throw new Error(`The folder of crew member ${member} is missing: ${dir}`);
  const email = stringFlag(flags['--email']);
  const extra = [...(email ? ['--email', email] : []), ...(flags['--sso'] ? ['--sso'] : [])];
  if (action === 'logout') return startClaude(['auth', 'logout'], dir);
  if (extra.length === 0) console.log(say('warn', `Claude Code opens for ${member}. Log in there, then type /exit to come back.`));
  return startClaude(loginArgs(extra), dir);
}

function rename(args: string[]): number {
  const { positional } = parseArgs(args);
  if (positional.length !== 2) usage('crew rename <old> <new>');
  const [from, to] = positional;
  renameMember(loadConfig(), from, to);
  console.log(`Renamed crew member ${from} to ${to}.`);
  return 0;
}

async function drop(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args, [], ['--force', '--yes']);
  if (positional.length !== 1) usage('crew drop <member> [--force] [--yes]');
  const [member] = positional;
  const config = loadConfig();
  memberOrThrow(config, member);
  if (config.current === member && !flags['--force']) {
    throw new Error(`${member} is the current crew member. Switch first with crew use <member>, or pass --force.`);
  }
  for (const line of removalImpact(config, member)) console.log(line);
  if (!flags['--yes']) {
    needTerminal('Confirming the drop', 'Pass --yes to drop without asking.');
    if (!(await askYesNo(`Drop crew member ${member}? Its folder is moved to ${removedDir()}`, false))) {
      console.log('Nothing dropped.');
      return 0;
    }
  }
  const movedTo = removeMember(config, member);
  console.log(movedTo ? `Dropped crew member ${member}. Its folder is kept at ${movedTo}` : `Dropped crew member ${member}. Its folder was already gone.`);
  return 0;
}

async function shipDelete(config: Config, args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args, [], ['--force', '--yes']);
  if (positional.length !== 1) usage('crew ship delete <ship> [--force] [--yes]');
  const [ship] = positional;
  checkName('ship', ship);
  const members = shipMembers(config, ship);
  if (!shipExists(ship) && members.length === 0) throw new Error(`Ship ${ship} doesn't exist`);
  if (members.length > 0 && !flags['--force']) {
    throw new Error(`Ship ${ship} still has members aboard: ${members.join(', ')}. Run crew ship leave <member> for each first, or pass --force.`);
  }
  console.log(`Folder: ${shipDir(ship)}`);
  console.log(`Members linked: ${members.length > 0 ? `${members.join(', ')} (unlinked first; they become isolated)` : 'none'}`);
  console.log(`Session files: ${countSessionFiles(shipProjectsDir(ship))}`);
  if (!flags['--yes']) {
    needTerminal('Confirming the deletion', 'Pass --yes to delete without asking.');
    if (!(await askYesNo(`Delete ship ${ship}? Its folder is moved to ${removedDir()}`, false))) {
      console.log('Nothing deleted.');
      return 0;
    }
  }
  for (const member of members) leaveShip(config, member);
  saveConfig(config);
  const movedTo = shipExists(ship) ? moveToRemoved(shipDir(ship), `ship-${ship}`, 'Its members were unlinked first; nothing else changed.') : null;
  console.log(movedTo ? `Deleted ship ${ship}. Its folder is kept at ${movedTo}` : `Deleted ship ${ship}.`);
  return 0;
}

// Never prints env, headers or a URL's query, which is where MCP servers keep their keys.
function describeServer(server: unknown): string {
  const entry = server as { type?: string; url?: string; command?: string; args?: unknown[] };
  if (typeof entry?.url === 'string') return `${entry.type ?? 'http'}  ${entry.url.split('?')[0]}`;
  if (typeof entry?.command === 'string') return `stdio  ${entry.command}${entry.args?.length ? ` (+${entry.args.length} args)` : ''}`;
  return '';
}

function parseServer(args: string[]): Record<string, unknown> {
  const at = args.indexOf('--');
  const flags = at === -1 ? args : args.slice(0, at);
  const command = at === -1 ? [] : args.slice(at + 1);
  let url: string | undefined;
  let transport: string | undefined;
  const headers: Record<string, string> = {};
  const env: Record<string, string> = {};
  for (let i = 0; i < flags.length; i += 2) {
    const [flag, value] = [flags[i], flags[i + 1]];
    if (value === undefined) throw new Error(`${flag} needs a value.`);
    const split = (separator: string) => {
      const cut = value.indexOf(separator);
      if (cut < 1) throw new Error(`${flag} takes ${separator === ':' ? '"Name: value"' : 'KEY=value'}.`);
      return [value.slice(0, cut).trim(), value.slice(cut + 1).trim()];
    };
    if (flag === '--url') url = value;
    else if (flag === '--transport') transport = value;
    else if (flag === '--header') {
      const [name, text] = split(':');
      headers[name] = text;
    } else if (flag === '--env') {
      const [name, text] = split('=');
      env[name] = text;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (url && command.length > 0) throw new Error('Give either --url or a command after --, not both.');
  if (url) return { type: transport ?? 'http', url, ...(Object.keys(headers).length > 0 ? { headers } : {}) };
  if (command.length > 0) return { type: 'stdio', command: command[0], args: command.slice(1), ...(Object.keys(env).length > 0 ? { env } : {}) };
  throw new Error('Give --url <url> for an HTTP server, or -- <command> [args] for a local one.');
}

// One server's definition from another config, such as a ccs seat's .claude.json; keys come along as they are.
function serverFrom(file: string, name: string): unknown {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${file}: ${(error as Error).message}`);
  }
  const server = data?.mcpServers?.[name];
  if (!server) throw new Error(`${file} has no MCP server ${name}`);
  return server;
}

function shipImport(args: string[]): number {
  const { positional, flags } = parseArgs(args, ['--from']);
  const from = stringFlag(flags['--from']);
  if (positional.length !== 1 || !from) usage('crew ship import <ship> --from <folder>');
  const [name] = positional;
  checkName('ship', name);
  if (!shipExists(name)) throw new Error(`Ship ${name} doesn't exist. Make it first with: crew ship create ${name}`);
  if (!fs.statSync(from, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${from} is not a folder`);
  const counts = importIntoShip(name, path.resolve(from));
  if (Object.keys(counts).length === 0) throw new Error(`${from} holds none of: ${SHIP_FOLDERS.join(', ')}`);
  for (const [folder, count] of Object.entries(counts)) {
    console.log(`${paint('text', folder.padEnd(16), true)} ${count.copied} copied, ${count.updated} brought up to date, ${count.skipped} already there, ${count.kept} kept beside a changed copy`);
  }
  console.log(`Imported into ship ${name}. ${from} was only read.`);
  return 0;
}

// A ship's MCP servers, copied into each of its members at launch; keys stay in this local file.
function shipMcp(args: string[]): number {
  const [action, name, server, ...rest] = args;
  const shipUsage = [
    'crew ship mcp list <ship>',
    'crew ship mcp add <ship> <name> --url <url> [--header "Name: value"]',
    'crew ship mcp add <ship> <name> [--env KEY=value] -- <command> [args]',
    'crew ship mcp add <ship> <name> --from <.claude.json>',
    'crew ship mcp remove <ship> <name>',
  ].join(' | ');
  if (!name) usage(shipUsage);
  checkName('ship', name);
  if (!shipExists(name)) throw new Error(`Ship ${name} doesn't exist`);
  const servers = readShipMcp(name);
  if (action === 'list' && server === undefined) {
    const names = Object.keys(servers).sort();
    if (names.length === 0) console.log(`Ship ${name} has no MCP servers. Add one with: crew ship mcp add ${name} <name> ...`);
    for (const entry of names) console.log(`${entry}  ${describeServer(servers[entry])}`);
    console.log(`File: ${shipMcpFile(name)}`);
    return 0;
  }
  if (action === 'add' && server) {
    servers[server] = rest[0] === '--from' && rest.length === 2 ? serverFrom(rest[1], server) : parseServer(rest);
    writeShipMcp(name, servers);
    console.log(`Added ${server} to ship ${name}. Its members get it at their next launch.`);
    return 0;
  }
  if (action === 'remove' && server && rest.length === 0) {
    if (!(server in servers)) throw new Error(`Ship ${name} has no MCP server ${server}`);
    delete servers[server];
    writeShipMcp(name, servers);
    console.log(`Removed ${server} from ship ${name}. Its members lose it at their next launch.`);
    return 0;
  }
  usage(shipUsage);
}

async function ship(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (action === 'mcp') return shipMcp(rest);
  if (action === 'import') return shipImport(rest);
  const config = loadConfig();
  const { positional } = action === 'delete' ? { positional: [] } : parseArgs(rest);

  if (action === 'create' && positional.length === 1) {
    const [name] = positional;
    checkName('ship', name);
    if (shipExists(name)) throw new Error(`Ship ${name} already exists`);
    createShip(name);
    console.log(`Created ship ${name}: ${shipProjectsDir(name)}`);
    return 0;
  }
  if (action === 'list' && positional.length === 0) {
    const ships = listShips(config);
    if (ships.length === 0) console.log('No ships yet. Make one with: crew ship create <ship>');
    for (const name of ships) {
      const members = shipMembers(config, name);
      console.log(`${paint('text', `${name}:`, true)} ${members.length > 0 ? members.join(', ') : paint('faint', 'no members')}`);
      console.log(`  ${paint('faint', shipProjectsDir(name))}`);
    }
    return 0;
  }
  if (action === 'rename' && positional.length === 2) {
    const [from, to] = positional;
    checkName('ship', from);
    checkName('ship', to);
    if (!shipExists(from)) throw new Error(`Ship ${from} doesn't exist`);
    if (shipExists(to) || shipMembers(config, to).length > 0) throw new Error(`Ship ${to} already exists`);
    for (const note of renameShip(config, from, to)) console.log(say('info', note));
    console.log(`Renamed ship ${from} to ${to}.`);
    return 0;
  }
  if (action === 'delete') return shipDelete(config, rest);
  if (action === 'join' && positional.length === 2) {
    const [member, name] = positional;
    memberOrThrow(config, member);
    checkName('ship', name);
    if (!shipExists(name)) {
      needTerminal(`Ship ${name} doesn't exist. Creating it`, `Make it first with: crew ship create ${name}`);
      if (!(await askYesNo(`Ship ${name} doesn't exist. Create it? (Y/n)`, true))) {
        console.log('Nothing changed.');
        return 0;
      }
      createShip(name);
    }
    const notes = joinShip(config, member, name);
    saveConfig(config);
    for (const note of notes) console.log(say('info', note));
    console.log(`${member} shares history through ship ${name}.`);
    return 0;
  }
  if (action === 'leave' && positional.length === 1) {
    const [member] = positional;
    memberOrThrow(config, member);
    const notes = leaveShip(config, member);
    saveConfig(config);
    for (const note of notes) console.log(say('info', note));
    return 0;
  }
  usage('crew ship create|list|rename|delete|join|leave|mcp|import (see crew --help)');
}

function configCommand(args: string[]): number {
  const config = loadConfig();
  if (args[0] === 'permissions' && (args[1] === 'on' || args[1] === 'off') && args.length === 2) {
    config.skipPermissions = args[1] === 'on';
    saveConfig(config);
    console.log(`--dangerously-skip-permissions is ${args[1]} for every launch.`);
    return 0;
  }
  if (args[0] === 'refresh' && (args[1] === 'on' || args[1] === 'off') && args.length === 2) {
    config.refreshReadings = args[1] === 'on';
    saveConfig(config);
    if (config.refreshReadings) {
      console.log('The menu reads every member\'s usage with quota-axi as it opens; no message is sent.');
      console.log('Turn it off with: crew config refresh off');
    } else {
      console.log('The menu shows each member\'s last reading.');
    }
    return 0;
  }
  if (args[0] === 'lavish' && (args[1] === 'on' || args[1] === 'off') && args.length === 2) {
    config.lavishRule = args[1] === 'on';
    saveConfig(config);
    console.log(config.lavishRule ? 'Every session starts with the Lavish rule from the crewrota plugin.' : 'Sessions start without the Lavish rule.');
    return 0;
  }
  if (args[0] === 'show' && args.length === 1) {
    const permissions = config.skipPermissions === null ? 'not asked yet' : config.skipPermissions ? 'on' : 'off';
    const field = (label: string, value: string) => console.log(`${paint('faint', label)} ${value}`);
    field('Config file:', configFile());
    field('Crew home:', crewHome());
    field('--dangerously-skip-permissions:', permissions);
    field('Usage check when the menu opens:', config.refreshReadings === false ? 'off' : 'on');
    field('Lavish rule at session start:', config.lavishRule === false ? 'off' : 'on');
    field('Lavish telemetry:', config.lavishTelemetry === undefined ? 'not asked yet (crew setup asks)' : config.lavishTelemetry ? 'on' : 'off');
    field('Last model:', `${config.lastModel ?? 'default'}, last effort: ${config.lastEffort ?? 'default'}`);
    field('Current member:', `${config.current ?? 'none'}, previous: ${config.previous ?? 'none'}`);
    for (const [name, member] of Object.entries(config.members)) {
      const ship = member.ship ? `ship ${member.ship}` : 'isolated';
      console.log(`  ${paint('text', `${name}:`, true)} model ${member.model ?? 'default'}, effort ${member.effort ?? 'default'}, ${ship}`);
    }
    return 0;
  }
  usage('crew config permissions on|off | crew config refresh on|off | crew config lavish on|off | crew config show');
}

function doctor(args: string[]): number {
  const { positional, flags } = parseArgs(args, [], ['--logins']);
  if (positional.length > 0) usage('crew doctor [--logins]');
  const checks = [...runDoctor({ logins: flags['--logins'] === true }), ...toolChecks()];
  for (const check of checks) {
    const mark = check.ok ? paint('green', 'ok  ') : check.optional ? paint('amber', 'miss') : paint('red', 'FAIL', true);
    console.log(`${mark}  ${check.detail}`);
    if (!check.ok && check.fix) console.log(`      ${paint('amber', 'fix:')} ${check.fix}`);
  }
  return checks.every((check) => check.ok || check.optional) ? 0 : 1;
}

async function setup(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args, [], ['--yes', '--with-hooks']);
  if (positional.length > 0) usage('crew setup [--yes] [--with-hooks]');
  return runSetup(
    { yes: flags['--yes'] === true, withHooks: flags['--with-hooks'] === true },
    { run: realSetupRunner, ask: (message, initialValue) => askYesNo(message, initialValue), interactive: interactive(), print: (line) => console.log(line) },
  );
}

function init(args: string[]): number {
  noArgs(args, 'crew init');
  const folder = process.cwd();
  const { created, kept } = initProject(folder);
  for (const file of created) console.log(say('ok', `created ${file}`));
  for (const file of kept) console.log(say('info', `left alone ${file}`));
  console.log(created.length > 0 ? `The project's .claude/ folder is ready in ${folder}` : `Nothing to create: ${folder} already has every file.`);
  return 0;
}

// Claude Code pipes the session's JSON in; never fails, so the status line never shows an error.
function statusline(): number {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  let input: unknown = {};
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    // no payload: print what we can
  }
  if (dir) {
    try {
      writeQuota(dir, input);
    } catch {
      // a reading that cannot be saved is skipped
    }
  }
  console.log(statusText(dir ? `crew ${path.basename(dir)}` : '', input));
  return 0;
}

function noArgs(args: string[], command: string): void {
  if (args.length > 0) usage(command);
}

async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === undefined) return menu();
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(styledHelp());
    return 0;
  }
  if (command === '--version' || command === '-v') {
    console.log(version());
    return 0;
  }
  if (command === 'use') return use(rest);
  if (command === 'add') return add(rest);
  if (command === 'run') return run(rest);
  if (command === 'login' || command === 'logout') return auth(command, rest);
  if (command === 'rename') return rename(rest);
  if (command === 'drop' || command === 'remove') return drop(rest);
  if (command === 'ship') return ship(rest);
  if (command === 'config') return configCommand(rest);
  if (command === 'doctor') return doctor(rest);
  if (command === 'setup') return setup(rest);
  if (command === 'init') return init(rest);
  if (command === 'statusline') return statusline();
  if (command === 'quota') return quota(rest);
  if (command === 'warmup') return warmup(rest);
  if (command === 'widget') return widget(rest);
  if (command === 'list' || command === 'ls' || command === 'whoami' || command === 'current') {
    noArgs(rest, `crew ${command}`);
    return command === 'list' || command === 'ls' ? list() : command === 'whoami' ? whoami() : current();
  }
  if (loadConfig().members[command]) return run(args);
  console.error(`Unknown command: ${args.join(' ')}\n`);
  console.error(HELP);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: Error) => {
    console.error(`${paintError('red', 'crewrota:', true)} ${error.message}`);
    process.exitCode = 1;
  },
);
