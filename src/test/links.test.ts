import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mock, test, type TestContext } from 'node:test';
import { countSessionFiles, findLinks, freePath, linkState, lstatOrNull, makeDirLink, moveToRemoved, renameFolder, stamp, unlinkAll } from '../links.js';
import { removedDir } from '../paths.js';
import { isolate, onPlatform } from './helpers.js';

const root = isolate();
let boxes = 0;

function box(): string {
  const dir = path.join(root, `box-${boxes++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function write(file: string, text = 'data'): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function folder(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Every path below dir with its text; a link is recorded as a link and never entered.
function snapshot(dir: string): Record<string, string> {
  const found: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of fs.readdirSync(at)) {
      const file = path.join(at, name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) found[path.relative(dir, file)] = 'link';
      else if (stat.isDirectory()) walk(file);
      else found[path.relative(dir, file)] = fs.readFileSync(file, 'utf8');
    }
  };
  walk(dir);
  return found;
}

// A folder with files, one of them a link of its own, that a link can point at.
function target(): { dir: string; inner: string; before: Record<string, string> } {
  const dir = box();
  write(path.join(dir, 'history', 'session.jsonl'), 'ship history');
  write(path.join(dir, 'top.txt'), 'top');
  const inner = path.join(dir, 'inner-link');
  makeDirLink(box(), inner);
  return { dir, inner, before: snapshot(dir) };
}

function dangling(link: string): string {
  const gone = box();
  makeDirLink(gone, link);
  fs.rmdirSync(gone);
  return link;
}

function fileLink(t: TestContext, to: string, link: string): boolean {
  try {
    fs.symlinkSync(to, link, 'file');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    t.skip('file links need Developer Mode on this Windows machine');
    return false;
  }
}

test('lstatOrNull gives null for nothing, and the link itself for a link, even a dangling one', () => {
  const dir = box();
  assert.equal(lstatOrNull(path.join(dir, 'nothing')), null);
  assert.equal(lstatOrNull(dangling(path.join(dir, 'link')))?.isSymbolicLink(), true);
  assert.equal(lstatOrNull(dir)?.isDirectory(), true);
});

test('freePath takes the first free name, and a file or a dangling link takes a name up', () => {
  const dir = box();
  const name = (n: number) => path.join(dir, `name-${n}`);
  assert.equal(freePath(name), name(0));
  write(name(0));
  dangling(name(1));
  folder(name(2));
  assert.equal(freePath(name), name(3));
});

test('linkState reads ok however the target path is written, and through a second link', () => {
  const dir = box();
  const place = folder(path.join(dir, 'place'));
  const link = path.join(dir, 'link');
  makeDirLink(place, link);
  assert.equal(linkState(link, place), 'ok');
  assert.equal(linkState(link, path.join(dir, 'other', '..', 'place')), 'ok');
  const second = path.join(dir, 'second');
  makeDirLink(place, second);
  assert.equal(linkState(link, second), 'ok');
});

test('linkState reads elsewhere for a link to another folder, or when the expected folder does not exist', () => {
  const dir = box();
  const link = path.join(dir, 'link');
  makeDirLink(folder(path.join(dir, 'place')), link);
  assert.equal(linkState(link, folder(path.join(dir, 'other'))), 'elsewhere');
  assert.equal(linkState(link, path.join(dir, 'never-made')), 'elsewhere');
});

test('linkState reads a plain file as not-a-link, and a dangling link as dangling whatever is expected', () => {
  const dir = box();
  assert.equal(linkState(write(path.join(dir, 'file')), dir), 'not-a-link');
  assert.equal(linkState(dangling(path.join(dir, 'link')), dir), 'dangling');
});

test('linkState ignores the case of the path on Windows', { skip: process.platform !== 'win32' }, () => {
  const dir = box();
  const place = folder(path.join(dir, 'Place'));
  const link = path.join(dir, 'link');
  makeDirLink(place, link);
  assert.equal(linkState(link, path.join(dir, 'PLACE')), 'ok');
});

test('makeDirLink makes a link, reads a relative target from the link\'s folder, and removing it leaves the target', () => {
  const dir = box();
  const place = folder(path.join(dir, 'place'));
  write(path.join(place, 'kept.txt'), 'kept');
  const link = path.join(dir, 'link');
  makeDirLink('place', link);
  assert.equal(lstatOrNull(link)?.isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(link, 'kept.txt'), 'utf8'), 'kept');
  fs.unlinkSync(link);
  assert.equal(fs.readFileSync(path.join(place, 'kept.txt'), 'utf8'), 'kept');
});

test('makeDirLink refuses a name already taken and leaves what is there', () => {
  const dir = box();
  const taken = folder(path.join(dir, 'taken'));
  write(path.join(taken, 'mine.txt'), 'mine');
  assert.throws(() => makeDirLink(box(), taken), { code: 'EEXIST' });
  assert.equal(lstatOrNull(taken)?.isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(taken, 'mine.txt'), 'utf8'), 'mine');
});

test('findLinks finds links at every depth and never enters one', () => {
  const dir = box();
  const { dir: place, inner } = target();
  const top = path.join(dir, 'top');
  const deep = path.join(folder(path.join(dir, 'a', 'b', 'c')), 'deep');
  makeDirLink(place, top);
  makeDirLink(place, deep);
  write(path.join(dir, 'a', 'plain.txt'));

  const found = findLinks(dir).sort();
  assert.deepEqual(found, [top, deep].sort());
  assert.ok(!found.some((file) => file.includes(path.basename(inner))));
});

test('findLinks reports a dangling link and an empty folder gives nothing', () => {
  const dir = box();
  assert.deepEqual(findLinks(dir), []);
  const link = dangling(path.join(dir, 'link'));
  assert.deepEqual(findLinks(dir), [link]);
});

test('findLinks stops at a link back to its own parent instead of looping', () => {
  const dir = box();
  const loop = path.join(folder(path.join(dir, 'sub')), 'loop');
  makeDirLink(dir, loop);
  assert.deepEqual(findLinks(dir), [loop]);
});

test('findLinks reports a link to a file', (t) => {
  const dir = box();
  const link = path.join(dir, 'link.md');
  if (fileLink(t, write(path.join(box(), 'real.md')), link)) assert.deepEqual(findLinks(dir), [link]);
});

test('findLinks given a folder that is itself a link reports that link and does not look inside', () => {
  const dir = box();
  const { dir: place } = target();
  const link = path.join(dir, 'member');
  makeDirLink(place, link);
  assert.deepEqual(findLinks(link), [link]);
});

test('unlinkAll removes every link, returns them, and the real files and every target stay byte for byte', () => {
  const dir = box();
  const { dir: place, before } = target();
  const top = path.join(dir, 'top');
  const deep = path.join(folder(path.join(dir, 'a', 'b')), 'deep');
  const broken = dangling(path.join(dir, 'a', 'broken'));
  makeDirLink(place, top);
  makeDirLink(place, deep);
  write(path.join(dir, 'a', 'b', 'keep.txt'), 'keep');

  assert.deepEqual(unlinkAll(dir).sort(), [broken, deep, top].sort());
  assert.deepEqual(findLinks(dir), []);
  assert.equal(fs.readFileSync(path.join(dir, 'a', 'b', 'keep.txt'), 'utf8'), 'keep');
  assert.deepEqual(snapshot(place), before);
});

test('unlinkAll does not reach the links inside a target', () => {
  const dir = box();
  const { dir: place, inner } = target();
  makeDirLink(place, path.join(dir, 'link'));
  unlinkAll(dir);
  assert.equal(lstatOrNull(inner)?.isSymbolicLink(), true);
});

test('unlinkAll with no links changes nothing', () => {
  const dir = box();
  write(path.join(dir, 'a', 'plain.txt'));
  const before = snapshot(dir);
  assert.deepEqual(unlinkAll(dir), []);
  assert.deepEqual(snapshot(dir), before);
});

test('after unlinkAll a recursive delete of the folder cannot reach any target', () => {
  const dir = box();
  const { dir: place, before } = target();
  const parent = box();
  write(path.join(parent, 'above.txt'), 'above');
  makeDirLink(place, path.join(folder(path.join(dir, 'deep')), 'link'));
  makeDirLink(parent, path.join(dir, 'parent'));
  unlinkAll(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(fs.existsSync(dir), false);
  assert.deepEqual(snapshot(place), before);
  assert.equal(fs.readFileSync(path.join(parent, 'above.txt'), 'utf8'), 'above');
});

test('unlinkAll with a loop back to the folder itself removes only the link', () => {
  const dir = box();
  write(path.join(dir, 'keep.txt'), 'keep');
  const loop = path.join(dir, 'loop');
  makeDirLink(dir, loop);
  assert.deepEqual(unlinkAll(dir), [loop]);
  assert.equal(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'keep');
});

test('unlinkAll given a folder that is itself a link leaves the links inside its target', () => {
  const dir = box();
  const { dir: place, inner } = target();
  const link = path.join(dir, 'member');
  makeDirLink(place, link);
  unlinkAll(link);
  assert.equal(lstatOrNull(inner)?.isSymbolicLink(), true);
});

test('stamp pads every part and can leave out the time', () => {
  const date = new Date(2026, 0, 2, 3, 4);
  assert.equal(stamp(date), '20260102-0304');
  assert.equal(stamp(date, false), '20260102');
  assert.equal(stamp(new Date(2026, 10, 25, 13, 59)), '20261125-1359');
});

test('renameFolder moves a folder with its files', () => {
  const dir = box();
  const from = folder(path.join(dir, 'from'));
  write(path.join(from, 'kept.txt'), 'kept');
  renameFolder(from, path.join(dir, 'to'));
  assert.equal(fs.existsSync(from), false);
  assert.equal(fs.readFileSync(path.join(dir, 'to', 'kept.txt'), 'utf8'), 'kept');
});

test('renameFolder explains a folder in use on Windows, says what happened, and the folder stays', () => {
  const dir = box();
  const from = folder(path.join(dir, 'from'));
  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    const rename = mock.method(fs, 'renameSync', () => {
      throw Object.assign(new Error('raw'), { code });
    });
    try {
      onPlatform('win32', () => {
        assert.throws(() => renameFolder(from, path.join(dir, 'to')), (error: Error) => error.message.includes(from) && /in use, probably by a running Claude session/.test(error.message) && error.message.endsWith('Nothing changed.'));
        assert.throws(() => renameFolder(from, path.join(dir, 'to'), 'Its links were removed.'), /Its links were removed\.$/);
      });
    } finally {
      rename.mock.restore();
    }
    assert.equal(fs.existsSync(from), true);
  }
});

test('renameFolder passes any other failure on as it is', () => {
  const dir = box();
  const from = folder(path.join(dir, 'from'));
  const rename = mock.method(fs, 'renameSync', () => {
    throw Object.assign(new Error('raw'), { code: 'EPERM' });
  });
  try {
    onPlatform('linux', () => assert.throws(() => renameFolder(from, path.join(dir, 'to')), /^Error: raw$/));
  } finally {
    rename.mock.restore();
  }
  assert.throws(() => renameFolder(path.join(dir, 'never-made'), path.join(dir, 'to')), { code: 'ENOENT' });
});

test('moveToRemoved moves the folder under removed/ with the name and the time', () => {
  const dir = box();
  const member = folder(path.join(dir, 'member'));
  write(path.join(member, 'kept.txt'), 'kept');
  const movedTo = moveToRemoved(member, 'stamped', undefined, new Date(2026, 0, 2, 3, 4));
  assert.equal(movedTo, path.join(removedDir(), 'stamped-20260102-0304'));
  assert.equal(fs.existsSync(member), false);
  assert.equal(fs.readFileSync(path.join(movedTo, 'kept.txt'), 'utf8'), 'kept');
});

test('moveToRemoved in the same minute takes the next free name and never touches what is already there', () => {
  const dir = box();
  const now = new Date(2026, 1, 3, 4, 5);
  const moved = [1, 2, 3].map((n) => {
    const member = folder(path.join(dir, `member-${n}`));
    write(path.join(member, 'which.txt'), String(n));
    return moveToRemoved(member, 'twice', undefined, now);
  });
  assert.deepEqual(moved.map((file) => path.basename(file)), ['twice-20260203-0405', 'twice-20260203-0405-2', 'twice-20260203-0405-3']);
  assert.deepEqual(moved.map((file) => fs.readFileSync(path.join(file, 'which.txt'), 'utf8')), ['1', '2', '3']);
});

test('moveToRemoved does not move onto a dangling link holding the name', () => {
  const dir = box();
  const now = new Date(2026, 2, 4, 5, 6);
  const base = path.join(removedDir(), 'held-20260304-0506');
  fs.mkdirSync(removedDir(), { recursive: true });
  dangling(base);
  const movedTo = moveToRemoved(folder(path.join(dir, 'member')), 'held', undefined, now);
  assert.equal(movedTo, `${base}-2`);
  assert.equal(lstatOrNull(base)?.isSymbolicLink(), true);
});

test('moveToRemoved given a folder that is itself a link moves only the link', () => {
  const dir = box();
  const { dir: place, before } = target();
  const link = path.join(dir, 'member');
  makeDirLink(place, link);
  const movedTo = moveToRemoved(link, 'linked');
  assert.equal(lstatOrNull(link), null);
  assert.equal(lstatOrNull(movedTo)?.isSymbolicLink(), true);
  assert.deepEqual(snapshot(place), before);
});

test('moveToRemoved leaves a link it carries along pointing at the untouched target', () => {
  const dir = box();
  const { dir: place, before } = target();
  const member = folder(path.join(dir, 'member'));
  makeDirLink(place, path.join(member, 'projects'));
  const movedTo = moveToRemoved(member, 'carried');
  assert.equal(fs.readFileSync(path.join(movedTo, 'projects', 'top.txt'), 'utf8'), 'top');
  assert.deepEqual(snapshot(place), before);
});

test('moveToRemoved of a folder that does not exist fails and adds nothing to removed/', () => {
  const dir = box();
  assert.throws(() => moveToRemoved(path.join(dir, 'never-made'), 'absent'), { code: 'ENOENT' });
  assert.ok(!fs.readdirSync(removedDir()).some((name) => name.startsWith('absent-')));
});

test('moveToRemoved hands its closing words to the message when Windows refuses', () => {
  const dir = box();
  const member = folder(path.join(dir, 'member'));
  const rename = mock.method(fs, 'renameSync', () => {
    throw Object.assign(new Error('raw'), { code: 'EBUSY' });
  });
  try {
    onPlatform('win32', () => assert.throws(() => moveToRemoved(member, 'busy', 'Its members were unlinked first.'), /Its members were unlinked first\.$/));
  } finally {
    rename.mock.restore();
  }
  assert.equal(fs.existsSync(member), true);
});

test('countSessionFiles counts .jsonl files at every depth and nothing else', () => {
  const dir = box();
  write(path.join(dir, 'a.jsonl'));
  write(path.join(dir, 'E--code', 'b.jsonl'));
  write(path.join(dir, 'E--code', 'deep', 'c.jsonl'));
  write(path.join(dir, 'E--code', 'notes.txt'));
  write(path.join(dir, 'E--code', 'd.jsonl.bak'));
  write(path.join(dir, 'folder.jsonl', 'e.jsonl'));
  assert.equal(countSessionFiles(dir), 4);
});

test('countSessionFiles gives 0 for nothing there, a file, or an empty folder', () => {
  const dir = box();
  assert.equal(countSessionFiles(path.join(dir, 'never-made')), 0);
  assert.equal(countSessionFiles(write(path.join(dir, 'a.jsonl'))), 0);
  assert.equal(countSessionFiles(folder(path.join(dir, 'empty'))), 0);
});

test('countSessionFiles does not follow a link, at the top or below', () => {
  const dir = box();
  const { dir: place } = target();
  assert.equal(countSessionFiles(place), 1);
  makeDirLink(place, path.join(dir, 'link'));
  assert.equal(countSessionFiles(dir), 0);
  assert.equal(countSessionFiles(path.join(dir, 'link')), 0);
  dangling(path.join(dir, 'broken'));
  assert.equal(countSessionFiles(dir), 0);
});

test('countSessionFiles does not count a link to a .jsonl file', (t) => {
  const dir = box();
  const real = write(path.join(box(), 'real.jsonl'));
  if (fileLink(t, real, path.join(dir, 'link.jsonl'))) assert.equal(countSessionFiles(dir), 0);
});
