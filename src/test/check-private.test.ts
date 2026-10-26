import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { isolate } from './helpers.js';

const root = isolate();
const script = fileURLToPath(new URL('../../scripts/check-private.mjs', import.meta.url));

// A throwaway git repo in the temp folder, with invented terms only.
const repo = path.join(root, 'repo');
fs.mkdirSync(repo);
execFileSync('git', ['init', '-q'], { cwd: repo });
const denylist = path.join(root, 'denylist.txt');
fs.writeFileSync(denylist, '# invented terms\n\nacme\nsecret-thing\n');

function scan(env: Record<string, string | undefined>) {
  const result = spawnSync(process.execPath, [script], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: result.status, out: result.stdout };
}

test('check-private exits 0 and prints clean when nothing matches', () => {
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'acmeville is a longer word\nnothing here\n');
  const { code, out } = scan({ CREWROTA_DENYLIST: denylist });
  assert.equal(code, 0);
  assert.equal(out.trim(), 'clean');
});

test('check-private exits 1 on a hit and prints file:line, never the term', () => {
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'first\nWorked with ACME.\nthird\n');
  fs.writeFileSync(path.join(repo, 'more.md'), 'a Secret-Thing here\n');
  const { code, out } = scan({ CREWROTA_DENYLIST: denylist });
  assert.equal(code, 1);
  assert.deepEqual(out.trim().split(/\r?\n/).sort(), ['more.md:1', 'notes.txt:2']);
  assert.doesNotMatch(out, /acme|secret-thing/i);
});

test('check-private exits 0 with one notice when there is no denylist', () => {
  const { code, out } = scan({ CREWROTA_DENYLIST: undefined });
  assert.equal(code, 0);
  assert.match(out, /no denylist/);
  assert.equal(out.trim().split(/\r?\n/).length, 1);
});
