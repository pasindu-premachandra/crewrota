import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { progress, silent } from '../progress.js';

function terminal(isTTY: boolean): { stream: Writable & { isTTY: boolean; columns: number }; text: () => string } {
  let written = '';
  const stream = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        written += chunk.toString();
        done();
      },
    }),
    { isTTY, columns: 100 },
  );
  return { stream, text: () => written };
}

test('progress draws one line in place with the bar, the percent and the text, and clears it at the end', () => {
  delete process.env.CI;
  const { stream, text } = terminal(true);
  const bar = progress('Copying', stream);
  bar.update(50, 100, '1.4 GB of 2.8 GB');
  const line = text();
  assert.ok(line.startsWith('\r\x1b[2K'));
  assert.match(line, /Copying/);
  assert.match(line, /50%/);
  assert.match(line, /1\.4 GB of 2\.8 GB/);
  assert.equal((line.match(/▖/g) ?? []).length, 24);
  bar.update(60, 100, 'too soon');
  assert.doesNotMatch(text(), /too soon/);
  bar.update(100, 100, 'done');
  assert.match(text(), /100%/);
  bar.end();
  assert.ok(text().endsWith('\r\x1b[2K'));
});

test('progress writes nothing when the stream is not a terminal or CI is set', () => {
  const piped = terminal(false);
  assert.equal(progress('Copying', piped.stream), silent);
  process.env.CI = 'true';
  const ci = terminal(true);
  assert.equal(progress('Copying', ci.stream), silent);
  delete process.env.CI;
});
