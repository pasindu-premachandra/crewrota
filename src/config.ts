import fs from 'node:fs';
import path from 'node:path';
import { configFile } from './paths.js';

export interface Member {
  provider: 'claude';
  ship?: string;
  model?: string;
  effort?: string;
  created: string;
}

export interface Config {
  skipPermissions: boolean | null;
  refreshReadings?: boolean; // probe every member's usage when the menu opens; on unless set to false
  lastModel?: string;
  lastEffort?: string;
  current?: string;
  previous?: string;
  members: Record<string, Member>;
}

export interface Choice {
  model: string;
  effort: string;
}

export function loadConfig(file = configFile()): Config {
  if (!fs.existsSync(file)) return { skipPermissions: null, members: {} };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    skipPermissions: typeof data.skipPermissions === 'boolean' ? data.skipPermissions : null,
    ...(data.refreshReadings === false ? { refreshReadings: false } : {}),
    lastModel: data.lastModel,
    lastEffort: data.lastEffort,
    current: data.current,
    previous: data.previous,
    members: data.members ?? {},
  };
}

export function saveConfig(config: Config, file = configFile()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
}

export function rememberedChoice(config: Config, member: string): Choice {
  const entry = config.members[member];
  return {
    model: entry?.model ?? config.lastModel ?? 'default',
    effort: entry?.effort ?? config.lastEffort ?? 'default',
  };
}

export function recordChoice(config: Config, member: string, choice: Choice): void {
  config.lastModel = choice.model;
  config.lastEffort = choice.effort;
  const entry = config.members[member];
  if (entry) {
    entry.model = choice.model;
    entry.effort = choice.effort;
  }
}

export function switchTo(config: Config, member: string): void {
  if (config.current === member) return;
  config.previous = config.current;
  config.current = member;
}
