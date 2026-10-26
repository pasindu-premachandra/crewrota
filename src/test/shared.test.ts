import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { linkState } from '../links.js';
import { mainClaudeDir, mainClaudeJson, memberDir } from '../paths.js';
import { mainMcpServers, syncSharedItems } from '../shared.js';
import { isolate, snapshot } from './helpers.js';

isolate();

// An invented main setup in the temp home folder.
const main = mainClaudeDir();
for (const name of ['skills', 'agents', 'commands']) {
  fs.mkdirSync(path.join(main, name, 'example'), { recursive: true });
  fs.writeFileSync(path.join(main, name, 'example', 'README.md'), `main ${name}`);
}
fs.writeFileSync(path.join(main, 'settings.json'), '{"statusLine": {"type": "command", "command": "status.sh"}}');
fs.writeFileSync(path.join(main, 'CLAUDE.md'), '# my main instructions\n');
const mainJson = {
  oauthAccount: { emailAddress: 'main@example.com', organizationName: '', organizationUuid: '' },
  numStartups: 7,
  mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp'] } },
};
fs.writeFileSync(mainClaudeJson(), JSON.stringify(mainJson, null, 2));
const plugins = path.join(main, 'plugins');
for (const name of ['cache/acme/tool', 'data', 'marketplaces/acme']) fs.mkdirSync(path.join(plugins, name), { recursive: true });
fs.writeFileSync(path.join(plugins, 'installed_plugins.json'), '{"version": 2, "plugins": {}}');
fs.writeFileSync(path.join(plugins, 'known_marketplaces.json'), JSON.stringify({ acme: { installLocation: path.join(plugins, 'marketplaces', 'acme') } }));

const dir = memberDir('work');
fs.mkdirSync(dir, { recursive: true });
const memberJson = {
  oauthAccount: { emailAddress: 'sam@example.com', organizationName: 'Example Org', organizationUuid: 'uuid-1' },
  projects: { 'E:/code/app': { allowedTools: [] } },
  mcpServers: { old: { command: 'old' } },
};
fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify(memberJson, null, 2));
fs.writeFileSync(path.join(dir, 'settings.json'), '{"member": "old"}');

const mainBefore = snapshot(main);
const mainJsonBefore = fs.readFileSync(mainClaudeJson());

test('skills, agents and commands are links to the main folders', () => {
  syncSharedItems(dir, mainMcpServers());
  for (const name of ['skills', 'agents', 'commands']) {
    assert.equal(linkState(path.join(dir, name), path.join(main, name)), 'ok', name);
    assert.equal(fs.readFileSync(path.join(dir, name, 'example', 'README.md'), 'utf8'), `main ${name}`);
  }
});

test('settings.json and CLAUDE.md are copied into the member as its own files', () => {
  for (const name of ['settings.json', 'CLAUDE.md']) {
    const copy = path.join(dir, name);
    assert.equal(fs.lstatSync(copy).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(copy, 'utf8'), fs.readFileSync(path.join(main, name), 'utf8'));
  }
});

test('only mcpServers is replaced in the member .claude.json', () => {
  const after = JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'));
  assert.deepEqual(after, { ...memberJson, mcpServers: mainJson.mcpServers });
});

test('a second sync changes nothing and the links stay', () => {
  const memberBefore = fs.readFileSync(path.join(dir, '.claude.json'));
  syncSharedItems(dir, mainMcpServers());
  assert.deepEqual(fs.readFileSync(path.join(dir, '.claude.json')), memberBefore);
  assert.equal(linkState(path.join(dir, 'skills'), path.join(main, 'skills')), 'ok');
});

test('a link pointing elsewhere is re-pointed, and an empty folder in the way is replaced', () => {
  fs.unlinkSync(path.join(dir, 'skills'));
  fs.mkdirSync(path.join(dir, 'skills'));
  fs.unlinkSync(path.join(dir, 'agents'));
  fs.symlinkSync(path.join(main, 'commands'), path.join(dir, 'agents'), process.platform === 'win32' ? 'junction' : 'dir');
  syncSharedItems(dir, mainMcpServers());
  assert.equal(linkState(path.join(dir, 'skills'), path.join(main, 'skills')), 'ok');
  assert.equal(linkState(path.join(dir, 'agents'), path.join(main, 'agents')), 'ok');
});

test('a member file that is a link is never written through', (t) => {
  const other = path.join(dir, '..', 'elsewhere.md');
  fs.writeFileSync(other, 'not mine');
  fs.renameSync(path.join(dir, 'CLAUDE.md'), path.join(dir, 'CLAUDE.md.bak'));
  try {
    fs.symlinkSync(other, path.join(dir, 'CLAUDE.md'), 'file');
  } catch (error) {
    fs.renameSync(path.join(dir, 'CLAUDE.md.bak'), path.join(dir, 'CLAUDE.md'));
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    t.skip('file links need Developer Mode on this Windows machine');
    return;
  }
  assert.throws(() => syncSharedItems(dir, mainMcpServers()), /CLAUDE\.md is a link/);
  assert.equal(fs.readFileSync(other, 'utf8'), 'not mine');
  fs.unlinkSync(path.join(dir, 'CLAUDE.md'));
  fs.renameSync(path.join(dir, 'CLAUDE.md.bak'), path.join(dir, 'CLAUDE.md'));
});

test('plugins get the ccs layout: shared folders linked, lists copied, marketplace paths pointed at the member', () => {
  const own = path.join(dir, 'plugins');
  assert.equal(fs.lstatSync(own).isSymbolicLink(), false);
  for (const name of ['cache', 'data', 'marketplaces']) assert.equal(linkState(path.join(own, name), path.join(plugins, name)), 'ok', name);
  assert.equal(fs.readFileSync(path.join(own, 'installed_plugins.json'), 'utf8'), '{"version": 2, "plugins": {}}');
  const known = JSON.parse(fs.readFileSync(path.join(own, 'known_marketplaces.json'), 'utf8'));
  assert.equal(known.acme.installLocation, path.join(own, 'marketplaces', 'acme'));
});

test("a member's own plugins folder is moved aside and kept, then linked like the others", () => {
  const other = memberDir('home');
  fs.mkdirSync(path.join(other, 'plugins', 'marketplaces', 'mine'), { recursive: true });
  fs.writeFileSync(path.join(other, 'plugins', 'marketplaces', 'mine', 'note.md'), 'mine');
  const notes = syncSharedItems(other, mainMcpServers());
  assert.match(notes[0], /Its own plugins folder is kept at .*plugins\.before-crewrota-/);
  const aside = fs.readdirSync(other).find((name) => name.startsWith('plugins.before-crewrota-'))!;
  assert.equal(fs.readFileSync(path.join(other, aside, 'marketplaces', 'mine', 'note.md'), 'utf8'), 'mine');
  assert.equal(linkState(path.join(other, 'plugins', 'marketplaces'), path.join(plugins, 'marketplaces')), 'ok');
});

test('the main ~/.claude folder and ~/.claude.json are byte-for-byte unchanged', () => {
  assert.deepEqual(snapshot(main), mainBefore);
  assert.deepEqual(fs.readFileSync(mainClaudeJson()), mainJsonBefore);
});
