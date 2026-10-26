import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { lstatOrNull } from './links.js';

// What crewrota puts in a member's settings.json when it has no status line of its own.
export const STATUS_COMMAND = 'crewrota statusline';

type Json = Record<string, unknown>;

function field(data: unknown, keys: string): unknown {
  return keys.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Json)[key] : undefined), data);
}

function missing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function readJsonOr(file: string, fallback: Json): Json {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Saves the session's rate limits to quota.json, the snapshot the menu reads. A window missing from this
// payload keeps its last reading. Returns false when nothing was written.
export function writeQuota(dir: string, input: unknown, now = Date.now()): boolean {
  const file = path.join(dir, 'quota.json');
  const old = readJsonOr(file, {});
  let seen = Math.floor(now / 1000);
  const transcript = field(input, 'transcript_path');
  if (typeof transcript === 'string') {
    const stat = fs.statSync(transcript, { throwIfNoEntry: false });
    if (stat) seen = Math.floor(stat.mtimeMs / 1000);
  }
  if (seen < Number(old.seen ?? 0)) return false; // an older session redrawing its last reading
  let fresh = false;
  const window = (name: string): [unknown, unknown] => {
    const pct = field(input, `rate_limits.${name}.used_percentage`);
    if (missing(pct)) return [old[`${name}_pct`] ?? '', old[`${name}_resets_at`] ?? ''];
    fresh = true;
    return [pct, field(input, `rate_limits.${name}.resets_at`) ?? ''];
  };
  const [fivePct, fiveAt] = window('five_hour');
  const [weekPct, weekAt] = window('seven_day');
  if (!fresh) return false;
  const quota = {
    ts: Math.floor(now / 1000),
    seen,
    five_hour_pct: fivePct,
    seven_day_pct: weekPct,
    five_hour_resets_at: fiveAt,
    seven_day_resets_at: weekAt,
  };
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(quota));
  fs.renameSync(`${file}.tmp`, file);
  return true;
}

const ANSI = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m' };

function pctColour(pct: number): string {
  return pct >= 80 ? ANSI.red : pct >= 50 ? ANSI.yellow : ANSI.green;
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// "Opus 5 (1M context)" reads as "Opus 5 (1M)".
function shortModel(name: string): string {
  return name.replace(/\((\S+)[^)]*\)/, '($1)');
}

function countdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
}

export function gitBranch(cwd: string): string {
  for (const args of [['symbolic-ref', '--short', 'HEAD'], ['rev-parse', '--short', 'HEAD']]) {
    try {
      const out = execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
      if (out) return out;
    } catch {
      // not a git folder, or no commits yet
    }
  }
  return '';
}

// One line in the shape of the main setup's statusline.sh: model, context, branch, 5-hour and week use,
// the 5-hour reset, the folder and the crew member. Colour unless NO_COLOR is set.
export function statusText(member: string, input: unknown, now = Date.now(), branchOf = gitBranch): string {
  const colour = !process.env.NO_COLOR;
  const paint = (code: string, text: string) => (colour ? `${code}${text}${ANSI.reset}` : text);
  const num = (keys: string) => {
    const value = field(input, keys);
    return missing(value) || Number.isNaN(Number(value)) ? null : Number(value);
  };
  const parts: string[] = [];
  const model = field(input, 'model.display_name');
  if (typeof model === 'string' && model) parts.push(paint(ANSI.magenta, clamp(shortModel(model), 18)));
  const context = num('context_window.used_percentage');
  if (context !== null) {
    const pct = Math.round(context);
    const filled = Math.min(10, Math.max(0, Math.floor(pct / 10)));
    parts.push(paint(pctColour(pct), `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${pct}%`));
  }
  const dir = field(input, 'workspace.current_dir') || field(input, 'cwd');
  const cwd = typeof dir === 'string' ? dir : '';
  const branch = cwd ? branchOf(cwd) : '';
  if (branch) parts.push(paint(ANSI.green, ` ${clamp(branch, 30)}`));
  const five = num('rate_limits.five_hour.used_percentage');
  if (five !== null) parts.push(paint(pctColour(five), `5h:${Math.round(five)}%`));
  const week = num('rate_limits.seven_day.used_percentage');
  if (week !== null) parts.push(paint(pctColour(week), `7d:${Math.round(week)}%`));
  const reset = num('rate_limits.five_hour.resets_at');
  if (reset !== null && reset > 0) {
    const at = new Date(reset * 1000);
    const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    parts.push(paint(pctColour(five ?? 0), `↻ ${clock} (${countdown(Math.max(0, reset - now / 1000))})`));
  }
  if (cwd) parts.push(paint(ANSI.bold + ANSI.cyan, clamp(path.basename(cwd), 14)));
  if (member) parts.push(paint(ANSI.bold + ANSI.blue, member));
  return parts.join(colour ? `${ANSI.dim} │ ${ANSI.reset}` : ' | ');
}

// A member with no status line of its own gets crewrota's, so the menu has 5-hour and weekly readings.
// A status line the member already has (its own, or copied from the main setup) is left alone.
export function ensureStatusLine(dir: string): void {
  const file = path.join(dir, 'settings.json');
  if (lstatOrNull(file)?.isSymbolicLink()) return;
  let settings: Json = {};
  if (fs.existsSync(file)) {
    settings = readJsonOr(file, null as unknown as Json);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return; // not ours to repair
  }
  if (settings.statusLine !== undefined) return;
  settings.statusLine = { type: 'command', command: STATUS_COMMAND };
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}
