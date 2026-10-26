#!/usr/bin/env node
// Fails when a tracked or new file contains a term from the private denylist. Prints file:line only, never the term.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const denylist = process.env.CREWROTA_DENYLIST || path.join(os.homedir(), '.config', 'crewrota-private', 'denylist.txt');
if (!fs.existsSync(denylist)) {
  console.log(`check-private: no denylist at ${denylist}, nothing to check.`);
  process.exit(0);
}

const escape = (term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = fs
  .readFileSync(denylist, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((term) =>
    /^[A-Za-z0-9]+$/.test(term)
      ? new RegExp(`(?<![A-Za-z0-9])${term}(?![A-Za-z0-9])`, 'i')
      : new RegExp(escape(term), 'i'),
  );

const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const hits = [];
for (const file of files) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (patterns.some((pattern) => pattern.test(line))) hits.push(`${file}:${i + 1}`);
  });
}

if (hits.length > 0) {
  for (const hit of hits) console.log(hit);
  process.exit(1);
}
console.log('clean');
