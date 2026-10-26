import fs from 'node:fs';
import path from 'node:path';
import { removedDir } from './paths.js';

export type LinkState = 'ok' | 'missing' | 'not-a-link' | 'dangling' | 'elsewhere';

export function lstatOrNull(file: string): fs.Stats | null {
  return fs.lstatSync(file, { throwIfNoEntry: false }) ?? null;
}

export function freePath(candidate: (n: number) => string): string {
  for (let n = 0; ; n++) {
    if (!lstatOrNull(candidate(n))) return candidate(n);
  }
}

function samePlace(a: string, b: string): boolean {
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b);
  } catch {
    return false;
  }
}

export function linkState(link: string, target: string): LinkState {
  const stat = lstatOrNull(link);
  if (!stat) return 'missing';
  if (!stat.isSymbolicLink()) return 'not-a-link';
  if (!fs.existsSync(link)) return 'dangling';
  return samePlace(link, target) ? 'ok' : 'elsewhere';
}

export function makeDirLink(target: string, link: string): void {
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

// Every link at or below dir, found without following any link.
export function findLinks(dir: string): string[] {
  const links: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) links.push(file);
    else if (stat.isDirectory()) links.push(...findLinks(file));
  }
  return links;
}

export function unlinkAll(dir: string): string[] {
  const links = findLinks(dir);
  for (const link of links) fs.unlinkSync(link);
  return links;
}

export function stamp(date: Date, withTime = true): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return withTime ? `${day}-${pad(date.getHours())}${pad(date.getMinutes())}` : day;
}

export function renameFolder(from: string, to: string, afterwards = 'Nothing changed.'): void {
  try {
    fs.renameSync(from, to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (process.platform === 'win32' && ['EPERM', 'EBUSY', 'EACCES'].includes(code)) {
      throw new Error(`Windows refused to move ${from} because a file in it is in use, probably by a running Claude session. Close it and try again. ${afterwards}`);
    }
    throw error;
  }
}

export function moveToRemoved(folder: string, name: string, afterwards?: string, now = new Date()): string {
  fs.mkdirSync(removedDir(), { recursive: true });
  const base = path.join(removedDir(), `${name}-${stamp(now)}`);
  const target = freePath((n) => (n === 0 ? base : `${base}-${n + 1}`));
  renameFolder(folder, target, afterwards);
  return target;
}

// Counts the .jsonl transcripts below dir without following links.
export function countSessionFiles(dir: string): number {
  const stat = lstatOrNull(dir);
  if (!stat?.isDirectory()) return 0;
  let count = 0;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const entry = fs.lstatSync(file);
    if (entry.isDirectory()) count += countSessionFiles(file);
    else if (entry.isFile() && name.endsWith('.jsonl')) count++;
  }
  return count;
}
