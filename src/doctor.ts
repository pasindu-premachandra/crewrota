import fs from 'node:fs';
import path from 'node:path';
import { type Runner, authStatus, claudeVersion, runSync } from './claude.js';
import { type Config, loadConfig } from './config.js';
import { linkState } from './links.js';
import { configFile, crewHome, memberDir, shipProjectsDir } from './paths.js';
import { sharedLinkStates } from './shared.js';
import { SHIP_FOLDERS, shipFolder } from './ships.js';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  optional?: boolean; // reported, never fails the doctor
}

const installClaude: Record<string, string> = {
  win32: 'Install Claude Code in PowerShell: irm https://claude.ai/install.ps1 | iex (or: winget install Anthropic.ClaudeCode). Then open a new terminal.',
  darwin: 'Install Claude Code in Terminal: curl -fsSL https://claude.ai/install.sh | bash (or: brew install --cask claude-code). Then open a new Terminal window.',
  linux: 'Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash. Then open a new shell.',
};

const installNode: Record<string, string> = {
  win32: 'Install Node.js 22 or newer from https://nodejs.org, then open a new terminal.',
  darwin: 'Install Node.js 22 or newer from https://nodejs.org, then open a new Terminal window.',
  linux: 'Install Node.js 22 or newer from https://nodejs.org, then open a new shell.',
};

const linkProblems: Record<string, string> = {
  missing: 'is missing',
  'not-a-link': 'is a folder, not a link',
  dangling: 'points at a folder that does not exist',
  elsewhere: 'points at a different folder',
};

function forThisOs(texts: Record<string, string>): string {
  return texts[process.platform] ?? texts.linux;
}

export function runDoctor(options: { logins?: boolean } = {}, run: Runner = runSync): Check[] {
  const checks: Check[] = [];

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'node', ok: nodeMajor >= 22, detail: `Node ${process.versions.node}`, fix: forThisOs(installNode) });

  const claude = claudeVersion(run);
  checks.push({
    name: 'claude',
    ok: claude !== null,
    detail: claude ? `claude ${claude}` : 'claude was not found',
    fix: forThisOs(installClaude),
  });

  const home = crewHome();
  try {
    if (fs.existsSync(home)) fs.readdirSync(home);
    checks.push({ name: 'home', ok: true, detail: `crewrota home ${home}${fs.existsSync(home) ? '' : ' (not created yet)'}` });
  } catch (error) {
    checks.push({ name: 'home', ok: false, detail: `${home} could not be read: ${(error as Error).message}`, fix: `Check the permissions of ${home}.` });
  }

  let config: Config | null = null;
  try {
    config = loadConfig();
    checks.push({ name: 'config', ok: true, detail: `config ${configFile()}${fs.existsSync(configFile()) ? '' : ' (not created yet)'}` });
  } catch (error) {
    checks.push({
      name: 'config',
      ok: false,
      detail: `${configFile()} could not be read: ${(error as Error).message}`,
      fix: `Fix the JSON in ${configFile()}, or rename the file so crewrota starts a fresh one.`,
    });
  }

  if (config) {
    const members = Object.keys(config.members).sort();
    if (members.length === 0) checks.push({ name: 'members', ok: true, detail: 'no crew members yet (add one with: crew add <member>)' });
    for (const member of members) checks.push(...memberChecks(config, member, options.logins === true, run));
    const state = config.skipPermissions === null ? 'not asked yet (asked at the first launch)' : config.skipPermissions ? 'on' : 'off';
    checks.push({ name: 'permissions', ok: true, detail: `--dangerously-skip-permissions: ${state}` });
  }

  return checks;
}

function memberChecks(config: Config, member: string, logins: boolean, run: Runner): Check[] {
  const dir = memberDir(member);
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return [{ name: 'member', ok: false, detail: `${member}: folder ${dir} is missing`, fix: `Log it in again with: crew login ${member} (or drop it with: crew drop ${member})` }];
  }
  const checks: Check[] = [{ name: 'member', ok: true, detail: `${member}: folder ${dir}` }];
  const repair = `Run: crew run ${member} (crewrota repairs links before every launch)`;

  const ship = config.members[member].ship;
  if (ship) {
    const state = linkState(path.join(dir, 'projects'), shipProjectsDir(ship));
    checks.push({
      name: 'ship join',
      ok: state === 'ok',
      detail: state === 'ok' ? `${member}: linked to ship ${ship}` : `${member}: the link to ship ${ship} ${linkProblems[state]}`,
      fix: repair,
    });
    for (const name of state === 'ok' ? SHIP_FOLDERS.filter((folder) => folder !== 'projects') : []) {
      const folderState = linkState(path.join(dir, name), shipFolder(ship, name));
      if (folderState !== 'dangling' && folderState !== 'elsewhere') continue; // missing or own folders are linked at the next launch
      checks.push({ name: 'ship join', ok: false, detail: `${member}: the ${name} link to ship ${ship} ${linkProblems[folderState]}`, fix: repair });
    }
  }

  for (const { link, state } of sharedLinkStates(dir)) {
    const name = path.basename(link);
    checks.push({
      name: 'shared link',
      ok: state === 'ok' || state === 'missing',
      detail: state === 'ok' ? `${member}: ${name} linked to your main setup` : state === 'missing' ? `${member}: ${name} is linked at the next launch` : `${member}: ${name} ${linkProblems[state]}`,
      fix: state === 'not-a-link' ? `Move ${link} somewhere else, then: crew run ${member}` : repair,
    });
  }

  if (logins) {
    const status = authStatus(dir, run);
    checks.push({
      name: 'login',
      ok: status.code === 0,
      detail: status.code === 0 ? `${member}: logged in` : `${member}: not logged in${status.problem ? ` (${status.problem})` : ''}`,
      fix: `Run: crew login ${member}`,
    });
  }
  return checks;
}
