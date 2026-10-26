import type { Writable } from 'node:stream';
import { styleText } from 'node:util';

// The site's palette in 24-bit colour; other terminals get the nearest named colour, pipes get none.
export const PALETTE = {
  text: ['#e6e9ef', 'white'],
  faint: ['#6f7684', 'gray'],
  empty: ['#2f333c', 'gray'],
  green: ['#3fb68b', 'green'],
  amber: ['#e0a43a', 'yellow'],
  red: ['#e5534b', 'red'],
} as const;
export type Tone = keyof typeof PALETTE;
const ROW_BACKGROUND = '#1f2229';

function rgb(hex: string): string {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(';');
}

export function painter(output: Writable) {
  const hasColors = (output as { hasColors?: (count: number) => boolean }).hasColors;
  const deep = typeof hasColors === 'function' && hasColors.call(output, 2 ** 24);
  const paint = (tone: Tone, value: string, bold = false): string => {
    if (deep) return `${bold ? '\x1b[1m' : ''}\x1b[38;2;${rgb(PALETTE[tone][0])}m${value}\x1b[39m${bold ? '\x1b[22m' : ''}`;
    const named = styleText(PALETTE[tone][1], value, { stream: output });
    return bold ? styleText('bold', named, { stream: output }) : named;
  };
  const highlight = (line: string, width: number): string => {
    const visible = line.replace(/\x1b\[[0-9;]*m/g, '').length;
    const padded = line + ' '.repeat(Math.max(0, width - visible));
    return deep ? `\x1b[48;2;${rgb(ROW_BACKGROUND)}m${padded}\x1b[49m` : padded;
  };
  return { paint, highlight };
}

export const { paint } = painter(process.stdout);
export const { paint: paintError } = painter(process.stderr);

type Tag = 'info' | 'ok' | 'warn';

const TAGS: Record<Tag, [string, Tone]> = {
  info: ['[i]', 'faint'],
  ok: ['[OK]', 'green'],
  warn: ['[!]', 'amber'],
};

export function say(tag: Tag, text: string): string {
  const [label, tone] = TAGS[tag];
  return `${paint(tone, label)} ${text}`;
}
