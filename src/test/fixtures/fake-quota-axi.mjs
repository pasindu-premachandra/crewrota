#!/usr/bin/env node
// Stands in for quota-axi in tests and demos. It prints a reading from FAKE_QUOTA_* values and reads no credentials.
import fs from 'node:fs';

const args = process.argv.slice(2);
const dir = process.env.CLAUDE_CONFIG_DIR;
const profiles = process.env.QUOTA_AXI_CLAUDE_PROFILES ?? null;
if (process.env.FAKE_QUOTA_LOG) fs.appendFileSync(process.env.FAKE_QUOTA_LOG, JSON.stringify({ args, dir: dir ?? null, profiles }) + '\n');

if (process.env.FAKE_QUOTA_EXIT) {
  console.error('fake quota-axi: failing as asked');
  process.exit(Number(process.env.FAKE_QUOTA_EXIT));
}

const window = (id, used, resetsAt) => ({ id, label: id, kind: id, percentRemaining: 100 - Number(used), resetsAt });
console.log(
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    schemaVersion: 5,
    providers: [
      {
        provider: 'claude',
        accountKeys: ['default'],
        windows: [
          window('five_hour', process.env.FAKE_QUOTA_FIVE ?? 30, '2033-05-18T03:33:20.000Z'),
          window('seven_day', process.env.FAKE_QUOTA_WEEK ?? 55, '2033-05-25T03:33:20.000Z'),
        ],
        state: { status: process.env.FAKE_QUOTA_STATUS ?? 'fresh', stale: Boolean(process.env.FAKE_QUOTA_STATUS) },
      },
    ],
  }),
);
