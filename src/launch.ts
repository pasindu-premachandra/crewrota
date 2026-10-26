import fs from 'node:fs';
import { type Choice, type Config, recordChoice, saveConfig } from './config.js';
import { memberDir } from './paths.js';
import { say } from './say.js';
import { mainMcpServers, syncSharedItems } from './shared.js';
import { healShipLink, readShipMcp } from './ships.js';
import { ensureStatusLine } from './statusline.js';

export interface LaunchDeps {
  askSkipPermissions: () => Promise<boolean | null>;
  start: (args: string[], dir: string, onSpawn: () => void, extraEnv: NodeJS.ProcessEnv) => Promise<number>;
}

export function launchArgs(choice: Choice, skipPermissions: boolean, extra: string[]): string[] {
  const args: string[] = [];
  if (choice.model !== 'default') args.push('--model', choice.model);
  if (choice.effort !== 'default') args.push('--effort', choice.effort);
  if (skipPermissions) args.push('--dangerously-skip-permissions');
  return [...args, ...extra];
}

// Returns null when the user cancels before anything starts.
export async function launch(
  member: string,
  choice: Choice,
  extra: string[],
  config: Config,
  deps: LaunchDeps,
): Promise<number | null> {
  const dir = memberDir(member);
  if (!fs.existsSync(dir)) throw new Error(`The folder of crew member ${member} is missing: ${dir}. Log it in again with: crew login ${member}`);
  let skipPermissions = config.skipPermissions;
  if (skipPermissions === null) {
    skipPermissions = await deps.askSkipPermissions();
    if (skipPermissions === null) return null;
  }
  for (const note of healShipLink(config, member)) console.log(say('info', note));
  const ship = config.members[member].ship;
  for (const note of syncSharedItems(dir, ship ? readShipMcp(ship) : mainMcpServers())) console.log(say('info', note));
  ensureStatusLine(dir);
  const extraEnv = config.lavishTelemetry === false ? { LAVISH_AXI_TELEMETRY: '0' } : {};
  return deps.start(launchArgs(choice, skipPermissions, extra), dir, () => {
    config.skipPermissions = skipPermissions;
    recordChoice(config, member, choice);
    saveConfig(config);
  }, extraEnv);
}
