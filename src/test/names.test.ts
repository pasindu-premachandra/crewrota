import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkName, validName } from '../names.js';

test('a name uses lowercase letters, digits and hyphens, starts with a letter, and is at most 32 characters', () => {
  for (const good of ['work', 'personal', 'projects2', 'team-a', 'a', 'a'.repeat(32)]) assert.equal(validName(good), true, good);
  for (const bad of ['', 'Work', '2work', '-work', 'work_1', 'work.1', 'a'.repeat(33), 'wörk', 'my work', '+add', '-', '..']) {
    assert.equal(validName(bad), false, bad);
  }
});

test('checkName says which kind of name is wrong and what the rule is', () => {
  assert.throws(() => checkName('ship', 'Team'), /"Team" is not a valid ship name\. A ship name uses lowercase letters/);
  assert.throws(() => checkName('crew member', 'a'.repeat(33)), /not a valid crew member name/);
  assert.doesNotThrow(() => checkName('crew member', 'work'));
});
