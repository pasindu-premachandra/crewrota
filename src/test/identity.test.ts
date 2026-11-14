import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { type Identity, describeIdentity, organizationLabel, readIdentity, sameIdentity } from '../identity.js';
import { isolate } from './helpers.js';

const root = isolate();
let folders = 0;

function memberFolder(content?: string): string {
  const dir = path.join(root, `member-${folders++}`);
  fs.mkdirSync(dir);
  if (content !== undefined) fs.writeFileSync(path.join(dir, '.claude.json'), content);
  return dir;
}

const identity = (email: string, organization: string, organizationUuid: string): Identity => ({ email, organization, organizationUuid });

test('readIdentity reads the email and organisation from .claude.json', () => {
  const account = { emailAddress: 'sam@example.com', organizationName: 'Acme', organizationUuid: 'uuid-1', other: 'ignored' };
  assert.deepEqual(readIdentity(memberFolder(JSON.stringify({ oauthAccount: account }))), identity('sam@example.com', 'Acme', 'uuid-1'));
});

test('readIdentity fills a missing or null organisation with empty strings', () => {
  assert.deepEqual(readIdentity(memberFolder('{"oauthAccount":{"emailAddress":"sam@example.com"}}')), identity('sam@example.com', '', ''));
  assert.deepEqual(readIdentity(memberFolder('{"oauthAccount":{"emailAddress":"sam@example.com","organizationName":null,"organizationUuid":null}}')), identity('sam@example.com', '', ''));
});

test('readIdentity gives null when there is no file, broken JSON, or no login with an email', () => {
  assert.equal(readIdentity(memberFolder()), null);
  assert.equal(readIdentity(path.join(root, 'never-made')), null);
  for (const content of ['', 'not json', 'null', '[]', '{}', '{"oauthAccount":null}', '{"oauthAccount":{}}', '{"oauthAccount":{"emailAddress":""}}', '{"oauthAccount":{"organizationName":"Acme"}}']) {
    assert.equal(readIdentity(memberFolder(content)), null, content);
  }
});

test('an account with no organisation is labelled personal', () => {
  assert.equal(organizationLabel(identity('a@example.com', '', '')), 'personal');
  assert.equal(organizationLabel(identity('a@example.com', 'Acme', 'uuid-1')), 'Acme');
});

test('describeIdentity shows the email with the organisation, or says there is no login', () => {
  assert.equal(describeIdentity(identity('a@example.com', 'Acme', 'uuid-1')), 'a@example.com (Acme)');
  assert.equal(describeIdentity(identity('a@example.com', '', '')), 'a@example.com (personal)');
  assert.equal(describeIdentity(null), 'no login found');
});

test('two identities are the same by email and organisation id, not by organisation name', () => {
  assert.equal(sameIdentity(identity('a@example.com', 'Old name', 'uuid-1'), identity('a@example.com', 'New name', 'uuid-1')), true);
  assert.equal(sameIdentity(identity('a@example.com', 'Acme', 'uuid-1'), identity('a@example.com', 'Acme', 'uuid-2')), false);
  assert.equal(sameIdentity(identity('a@example.com', '', ''), identity('a@example.com', 'Acme', 'uuid-1')), false);
  assert.equal(sameIdentity(identity('a@example.com', 'Acme', 'uuid-1'), identity('b@example.com', 'Acme', 'uuid-1')), false);
});
