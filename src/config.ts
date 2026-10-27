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

export interface Shortcut {
  name: string;
  member: string;
  folder: string;
  hotkey?: string;
}

export interface Config {
  skipPermissions: boolean | null;
  refreshReadings?: boolean; // probe every member's usage when the menu opens; on unless set to false
  lavishRule?: boolean; // the plugin's SessionStart rule; on unless set to false
  lavishTelemetry?: boolean; // answered in crew setup; false passes LAVISH_AXI_TELEMETRY=0 at launch
  lastModel?: string;
  lastEffort?: string;
  current?: string;
  previous?: string;
  members: Record<string, Member>;
  shortcuts?: Shortcut[];
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
    ...(data.lavishRule === false ? { lavishRule: false } : {}),
    ...(typeof data.lavishTelemetry === 'boolean' ? { lavishTelemetry: data.lavishTelemetry } : {}),
    lastModel: data.lastModel,
    lastEffort: data.lastEffort,
    current: data.current,
    previous: data.previous,
    members: data.members ?? {},
    ...(Array.isArray(data.shortcuts) ? { shortcuts: data.shortcuts } : {}),
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
