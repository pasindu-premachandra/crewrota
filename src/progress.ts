import type { Writable } from 'node:stream';
import { painter } from './say.js';

const CELLS = 24;
const REDRAW_MS = 100;

export interface Progress {
  update(done: number, total: number, text?: string): void;
  end(): void;
}

type Output = Writable & { isTTY?: boolean; columns?: number };

export const silent: Progress = { update() {}, end() {} };

// One line redrawn in place, drawn on each call rather than on a timer, so long synchronous copies still move it.
// Nothing at all when the stream is not a terminal, so pipes, logs and tests stay clean.
export function progress(label: string, output: Output = process.stderr): Progress {
  if (!output.isTTY || process.env.CI === 'true') return silent;
  const { paint } = painter(output);
  let last = 0;
  let drawn = false;
  return {
    update(done, total, text = '') {
      const now = Date.now();
      if (now - last < REDRAW_MS && (total === 0 || done < total)) return;
      last = now;
      const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : null;
      const filled = pct === null ? 0 : Math.round((pct / 100) * CELLS);
      const bar = `${paint('green', '▖'.repeat(filled))}${paint('empty', '▖'.repeat(CELLS - filled))}`;
      const head = `${label}  `;
      const middle = pct === null ? '' : `  ${String(pct).padStart(3)}%`;
      const room = (output.columns ?? 80) - head.length - CELLS - middle.length - 3;
      const tail = text && room > 4 ? `  ${text.length > room ? `${text.slice(0, room - 3)}...` : text}` : '';
      output.write(`\r\x1b[2K${paint('faint', head)}${bar}${middle}${paint('faint', tail)}`);
      drawn = true;
    },
    end() {
      if (drawn) output.write('\r\x1b[2K');
      drawn = false;
    },
  };
}
