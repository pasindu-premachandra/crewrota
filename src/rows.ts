import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';
import { describeIdentity, readIdentity } from './identity.js';
import { memberDir } from './paths.js';
import type { Tone } from './say.js';

export interface MemberRow {
  name: string;
  current: boolean;
  ship: string;
  usage: string;
  quota: Quota | null;
  identity: string;
}

export interface Quota {
  fiveHour: number | null;
  week: number | null;
}

function age(seconds: number): string {
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

function percent(value: unknown): string {
  if (value === '' || value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${Math.round(Number(value))}%`;
}

// quota.json is the snapshot a status line writes per config folder: ts, five_hour_pct, seven_day_pct.
export function readUsage(dir: string, now = Date.now()): string {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(dir, 'quota.json'), 'utf8'));
  } catch {
    return 'no reading yet';
  }
  if (typeof data?.ts !== 'number') return 'no reading yet';
  return `5h ${percent(data.five_hour_pct)}  7d ${percent(data.seven_day_pct)}  (${age(Math.max(0, now / 1000 - data.ts))})`;
}

function windowPercent(pct: unknown, resetsAt: unknown, now: number): number | null {
  if (pct === '' || pct === null || pct === undefined || Number.isNaN(Number(pct))) return null;
  if (typeof resetsAt === 'number' && resetsAt > 0 && now / 1000 > resetsAt) return 0; // the window reset since the reading
  return Math.round(Number(pct));
}

export function readQuota(dir: string, now = Date.now()): Quota | null {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(dir, 'quota.json'), 'utf8'));
  } catch {
    return null;
  }
  if (typeof data?.ts !== 'number') return null;
  return {
    fiveHour: windowPercent(data.five_hour_pct, data.five_hour_resets_at, now),
    week: windowPercent(data.seven_day_pct, data.seven_day_resets_at, now),
  };
}

// The reset times in quota.json that are still ahead, in seconds since the epoch.
export function readResets(dir: string, now = Date.now()): { fiveHour: number | null; week: number | null } {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(dir, 'quota.json'), 'utf8'));
  } catch {
    return { fiveHour: null, week: null };
  }
  const ahead = (at: unknown) => (typeof at === 'number' && at > now / 1000 ? at : null);
  return { fiveHour: ahead(data?.five_hour_resets_at), week: ahead(data?.seven_day_resets_at) };
}

export function memberRows(config: Config, now = Date.now()): MemberRow[] {
  return Object.keys(config.members)
    .sort()
    .map((name) => ({
      name,
      current: name === config.current,
      ship: config.members[name].ship ?? 'isolated',
      usage: readUsage(memberDir(name), now),
      quota: readQuota(memberDir(name), now),
      identity: describeIdentity(readIdentity(memberDir(name))),
    }));
}

type Tint = (tone: Tone, text: string, bold?: boolean) => string;

export function formatRows(rows: MemberRow[], withIdentity = false, tint: Tint = (_tone, text) => text): string[] {
  const width = (cells: string[]) => Math.max(...cells.map((cell) => cell.length));
  const nameWidth = width(rows.map((row) => row.name));
  const shipWidth = width(rows.map((row) => row.ship));
  const usageWidth = width(rows.map((row) => row.usage));
  return rows.map((row) => {
    const usage = withIdentity ? row.usage.padEnd(usageWidth) : row.usage;
    const cells = [row.current ? tint('green', '*') : ' ', tint('text', row.name.padEnd(nameWidth), true), tint('faint', row.ship.padEnd(shipWidth)), usage];
    if (withIdentity && row.identity) cells.push(tint('faint', row.identity));
    return cells.join('  ').trimEnd();
  });
}
