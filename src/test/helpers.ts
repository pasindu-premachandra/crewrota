import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config.js';
import type { Ui } from '../menu.js';
import { memberDir } from '../paths.js';

export const fixturesDir = fileURLToPath(new URL('../../src/test/fixtures/', import.meta.url));
export const fakeClaude = path.join(fixturesDir, 'fake-claude.mjs');
export const cliPath = fileURLToPath(new URL('../cli.js', import.meta.url));

// Points every home and config variable at a fresh temp folder, and claude at the fake.
export function isolate(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crewrota-test-'));
  const dirs = {
    HOME: 'home',
    USERPROFILE: 'home',
    APPDATA: 'appdata',
    XDG_CONFIG_HOME: 'xdg-config',
    XDG_DATA_HOME: 'xdg-data',
  };
  for (const [name, folder] of Object.entries(dirs)) {
    process.env[name] = path.join(root, folder);
    fs.mkdirSync(process.env[name]!, { recursive: true });
  }
  process.env.CREWROTA_HOME = path.join(root, 'crew-home');
  process.env.CREWROTA_CLAUDE = fakeClaude;
  for (const name of Object.keys(process.env)) {
    if (['CLAUDE_CONFIG_DIR', 'CREW_MEMBER', 'CREWROTA_DENYLIST'].includes(name) || name.startsWith('FAKE_CLAUDE_')) delete process.env[name];
  }
  return root;
}

// Registers a member with an invented login, without going through the creation workflow.
export function fakeMember(
  config: Config,
  name: string,
  options: { email?: string; org?: string; ship?: string } = {},
): string {
  const dir = memberDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const org = options.org ?? '';
  const oauthAccount = { emailAddress: options.email ?? `${name}@example.com`, organizationName: org, organizationUuid: org ? `uuid-${org}` : '' };
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount }));
  config.members[name] = { provider: 'claude', created: '2026-10-25T00:00:00.000Z' };
  if (options.ship) config.members[name].ship = options.ship;
  return dir;
}

export interface Asked {
  kind: string;
  message: string;
  initialValue?: unknown;
  options?: { value: unknown; label?: string }[];
}

// Answers prompts in order and records what each prompt asked.
export function scriptedUi(answers: unknown[]) {
  const asked: Asked[] = [];
  const answer = (kind: string) => async (opts: Omit<Asked, 'kind'>) => {
    asked.push({ kind, ...opts });
    return answers.shift();
  };
  const ui = { select: answer('select'), text: answer('text'), confirm: answer('confirm'), note: () => {} } as unknown as Ui;
  return { ui, asked };
}

export function readLog(file: string): { args: string[]; dir: string | null }[] {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
}

// Every file below dir with its bytes, links not followed.
export function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (folder: string) => {
    for (const name of fs.readdirSync(folder)) {
      const file = path.join(folder, name);
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else files[path.relative(dir, file)] = fs.readFileSync(file).toString('base64');
    }
  };
  walk(dir);
  return files;
}
