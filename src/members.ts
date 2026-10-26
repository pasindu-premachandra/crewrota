import fs from 'node:fs';
import path from 'node:path';
import { type AuthStatus, authStatus, startClaude } from './claude.js';
import { type Config, saveConfig, switchTo } from './config.js';
import { describeIdentity, readIdentity, sameIdentity } from './identity.js';
import { countSessionFiles, findLinks, lstatOrNull, moveToRemoved, renameFolder, unlinkAll } from './links.js';
import { type Ui, askShareHistory, askYesNo, clackUi } from './menu.js';
import { checkName } from './names.js';
import { memberDir, samePath, shipDir } from './paths.js';
import { say } from './say.js';
import { createShip, joinShip, listShips, shipExists } from './ships.js';

export interface MemberDeps {
  ui: Ui;
  login: (dir: string, flags: string[]) => Promise<number>;
  status: (dir: string) => AuthStatus;
  log: (line: string) => void;
}

export const realDeps: MemberDeps = {
  ui: clackUi,
  login: (dir, flags) => startClaude(loginArgs(flags), dir),
  status: (dir) => authStatus(dir),
  log: (line) => console.log(line),
};

// Plain claude asks for the login on its own first screen, where a pasted code is accepted (ccs signs in the same way);
// claude auth login only for --email or --sso, which only it takes.
export function loginArgs(flags: string[]): string[] {
  return flags.length > 0 ? ['auth', 'login', ...flags] : [];
}

export interface CreateOptions {
  ship?: string;
  email?: string;
  sso?: boolean;
}

export function memberOrThrow(config: Config, member: string): void {
  checkName('crew member', member);
  if (!config.members[member]) throw new Error(`Crew member ${member} doesn't exist. Create it with: crew add ${member}`);
}

function statusProblem(status: AuthStatus, dir: string): string | null {
  if (status.problem) return status.problem;
  if (status.code !== 0) return `claude auth status says the member is not logged in (exit code ${status.code})`;
  if (!status.configDirectory || !samePath(status.configDirectory, dir)) {
    return `claude auth status reported the config folder ${status.configDirectory ?? '(none)'} instead of ${dir}`;
  }
  return null;
}

// Only for a folder crewrota made moments ago, and only while no link exists in it.
function discardFresh(dir: string): void {
  const links = findLinks(dir);
  if (links.length > 0) throw new Error(`${dir} holds a link (${links[0]}), so crewrota left the folder in place.`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// The creation workflow. Returns false when the user cancels; nothing is then left behind.
export async function createMember(
  config: Config,
  member: string,
  options: CreateOptions,
  deps: MemberDeps,
  makeCurrent: 'always' | 'if-none',
): Promise<boolean> {
  const dir = memberDir(member);
  if (lstatOrNull(dir)) throw new Error(`${dir} already exists but is not a crew member. Move it away, or pick another name.`);
  if (options.ship && !shipExists(options.ship)) {
    if (!(await askYesNo(`Ship ${options.ship} doesn't exist. Create it? (Y/n)`, true, deps.ui))) return false;
  }

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const flags = [...(options.email ? ['--email', options.email] : []), ...(options.sso ? ['--sso'] : [])];
  deps.log(say('info', `Creating crew member: ${member}`));
  deps.log(say('info', `Member folder: ${dir}`));
  deps.log('');
  if (flags.length > 0) {
    deps.log(say('warn', `Starting Claude Code's own sign-in for ${member}...`));
    deps.log(say('warn', `A browser opens. Sign in with the account for ${member}, then come back here.`));
    deps.log(say('warn', 'If it asks for a code, paste it below.'));
  } else {
    deps.log(say('warn', `Starting Claude Code for ${member}. It asks you to log in:`));
    deps.log(say('warn', `sign in with the account for ${member} in the browser, and paste the code if it asks for one.`));
    deps.log(say('warn', "Once you see Claude's prompt, type /exit to come back here."));
  }
  deps.log('');
  const code = await deps.login(dir, flags);
  const problem = statusProblem(deps.status(dir), dir); // the login counts, not how Claude was closed
  if (problem) {
    discardFresh(dir);
    throw new Error(`${problem}${code !== 0 ? ` (claude exited with code ${code})` : ''}. Removed ${dir}; no crew member was created.`);
  }

  const identity = readIdentity(dir);
  deps.log('');
  deps.log(say('ok', `Signed in as ${describeIdentity(identity)}`));
  const twin = identity && Object.keys(config.members).find((other) => {
    const theirs = readIdentity(memberDir(other));
    return theirs !== null && sameIdentity(theirs, identity);
  });
  if (twin) deps.log(say('warn', `Crew member ${twin} is already signed in as ${describeIdentity(identity)}.`));

  let ship = options.ship;
  if (!ship) {
    const answer = await askShareHistory(listShips(config), deps.ui);
    if (answer === null) {
      discardFresh(dir);
      return false;
    }
    ship = answer.ship;
  }

  config.members[member] = { provider: 'claude', created: new Date().toISOString() };
  if (makeCurrent === 'always' || !config.current) switchTo(config, member);
  if (ship) {
    if (!shipExists(ship)) createShip(ship);
    for (const note of joinShip(config, member, ship)) deps.log(say('info', note));
  }
  saveConfig(config);
  deps.log('');
  deps.log(say('ok', `Crew member ${member} is ready, ${ship ? `sharing history on ship ${ship}` : 'isolated'}.`));
  if (ship) deps.log(say('info', `Ship folder: ${shipDir(ship)}`));
  if (config.current === member) deps.log(say('info', `${member} is now the current crew member.`));
  deps.log(say('info', `Start it with: crew run ${member}`));
  return true;
}

export async function addMember(config: Config, member: string, options: CreateOptions, deps: MemberDeps = realDeps): Promise<boolean> {
  checkName('crew member', member);
  if (options.ship) checkName('ship', options.ship);
  if (config.members[member]) throw new Error(`Crew member ${member} already exists`);
  return createMember(config, member, options, deps, 'if-none');
}

export async function useMember(config: Config, member: string, deps: MemberDeps = realDeps): Promise<boolean> {
  if (member === '-') {
    const previous = config.previous;
    if (!previous || !config.members[previous]) throw new Error('There is no previous crew member to go back to.');
    switchTo(config, previous);
  } else {
    checkName('crew member', member);
    if (!config.members[member]) {
      if (!(await askYesNo(`Crew member ${member} doesn't exist. Create it? (Y/n)`, true, deps.ui))) return false;
      return createMember(config, member, {}, deps, 'always');
    }
    switchTo(config, member);
  }
  saveConfig(config);
  deps.log(`Now using ${config.current}.`);
  return true;
}

export function renameMember(config: Config, from: string, to: string): void {
  memberOrThrow(config, from);
  checkName('crew member', to);
  if (config.members[to]) throw new Error(`Crew member ${to} already exists`);
  if (lstatOrNull(memberDir(to))) throw new Error(`${memberDir(to)} already exists. Move it away, or pick another name.`);
  if (lstatOrNull(memberDir(from))) renameFolder(memberDir(from), memberDir(to));
  config.members[to] = config.members[from];
  delete config.members[from];
  if (config.current === from) config.current = to;
  if (config.previous === from) config.previous = to;
  saveConfig(config);
}

export function removalImpact(config: Config, member: string): string[] {
  const dir = memberDir(member);
  const ship = config.members[member].ship;
  const lines = [`Folder: ${dir}`, `Ship: ${ship ? `${ship} (the ship keeps its history)` : 'isolated'}`];
  if (!ship) lines.push(`Session files in its projects folder: ${countSessionFiles(path.join(dir, 'projects'))}`);
  return lines;
}

// Unlinks every link in the member folder, then moves the folder to removed/. Returns where it went.
export function removeMember(config: Config, member: string): string | null {
  const dir = memberDir(member);
  let movedTo: string | null = null;
  if (lstatOrNull(dir)) {
    unlinkAll(dir);
    movedTo = moveToRemoved(dir, member, 'Its links were removed and are made again at its next launch; nothing else changed.');
  }
  delete config.members[member];
  if (config.current === member) config.current = undefined;
  if (config.previous === member) config.previous = undefined;
  saveConfig(config);
  return movedTo;
}
