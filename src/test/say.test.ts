import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { PALETTE, type Tone, painter, say } from '../say.js';
import { isolate } from './helpers.js';

isolate();
delete process.env.FORCE_COLOR; // it would colour the piped stream below

const piped = () => new PassThrough();
const deepColour = () => Object.assign(new PassThrough(), { hasColors(this: { asked?: number }, count: number) { this.asked = count; return true; } });
const namedColour = () => Object.assign(new PassThrough(), { isTTY: true, hasColors: () => false, getColorDepth: () => 4 });

test('a pipe gets plain text, bold or not', () => {
  const { paint } = painter(piped());
  for (const tone of Object.keys(PALETTE) as Tone[]) {
    assert.equal(paint(tone, 'text'), 'text');
    assert.equal(paint(tone, 'text', true), 'text');
  }
});

test('a 24-bit terminal is asked for its depth and gets the palette\'s exact colour', () => {
  const output = deepColour();
  const { paint } = painter(output);
  assert.equal((output as { asked?: number }).asked, 2 ** 24);
  assert.equal(paint('green', 'ok'), '\x1b[38;2;63;182;139mok\x1b[39m');
  assert.equal(paint('red', 'no'), '\x1b[38;2;229;83;75mno\x1b[39m');
  assert.equal(paint('text', 'bold', true), '\x1b[1m\x1b[38;2;230;233;239mbold\x1b[39m\x1b[22m');
});

test('every tone paints in its own 24-bit colour', () => {
  const { paint } = painter(deepColour());
  const painted = (Object.keys(PALETTE) as Tone[]).map((tone) => paint(tone, 'x'));
  assert.equal(new Set(painted).size, painted.length);
  for (const line of painted) assert.equal(stripVTControlCharacters(line), 'x');
});

test('a terminal without 24-bit colour gets the nearest named colour', () => {
  const { paint } = painter(namedColour());
  assert.equal(paint('green', 'ok'), '\x1b[32mok\x1b[39m');
  assert.equal(paint('amber', 'hm'), '\x1b[33mhm\x1b[39m');
  assert.equal(paint('red', 'no'), '\x1b[31mno\x1b[39m');
  assert.equal(paint('green', 'ok', true), '\x1b[1m\x1b[32mok\x1b[39m\x1b[22m');
});

test('highlight fills the width by what shows, not by the colour codes, and adds the background in 24-bit', () => {
  const { paint, highlight } = painter(deepColour());
  const line = paint('green', 'abc');
  assert.equal(highlight(line, 5), `\x1b[48;2;31;34;41m${line}  \x1b[49m`);
});

test('highlight never cuts a line wider than the width', () => {
  const { highlight } = painter(deepColour());
  assert.equal(highlight('abcdef', 3), '\x1b[48;2;31;34;41mabcdef\x1b[49m');
});

test('highlight without 24-bit colour only pads', () => {
  assert.equal(painter(piped()).highlight('abc', 5), 'abc  ');
  assert.equal(painter(namedColour()).highlight('abc', 2), 'abc');
});

test('say puts the tag before the text', () => {
  assert.equal(stripVTControlCharacters(say('info', 'note')), '[i] note');
  assert.equal(stripVTControlCharacters(say('ok', 'done')), '[OK] done');
  assert.equal(stripVTControlCharacters(say('warn', 'careful')), '[!] careful');
});
