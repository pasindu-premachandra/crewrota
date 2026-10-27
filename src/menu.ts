import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { Prompt } from '@clack/core';
import { confirm, isCancel, note, select, text } from '@clack/prompts';
import { type Choice, type Config, rememberedChoice } from './config.js';
import { nameRule, validName } from './names.js';
import { memberDir, packageRoot } from './paths.js';
import { formatRows, memberRows, readResets, type MemberRow } from './rows.js';
import { PALETTE, painter, type Tone } from './say.js';
import { listShips } from './ships.js';

export interface Ui {
  select: typeof select;
  text: typeof text;
  confirm: typeof confirm;
  note: typeof note;
}

export const clackUi: Ui = { select, text, confirm, note };

export const MODELS = ['default', 'fable', 'opus', 'sonnet'];
export const EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max'];
export const ADD_MEMBER = '+add'; // never a valid member name
export const TYPE_A_NAME = '(type a name)';
const BAR_CELLS = 14;

function optionLabel(value: string): string {
  return value === 'default' ? "Claude's default" : value;
}

// Returns a member name, ADD_MEMBER, or null when the user cancels.
export async function pickMember(config: Config, ui: Ui = clackUi): Promise<string | null> {
  const rows = memberRows(config);
  if (rows.length === 0) {
    const choice = await ui.select({
      message: 'No crew members yet',
      options: [{ value: ADD_MEMBER, label: 'Add your first crew member' }],
    });
    return isCancel(choice) ? null : ADD_MEMBER;
  }
  const lines = formatRows(rows);
  const choice = await ui.select({
    message: 'Crew member',
    options: [...rows.map((row, i) => ({ value: row.name, label: lines[i] })), { value: ADD_MEMBER, label: '+ Add a crew member' }],
    initialValue: config.current && config.members[config.current] ? config.current : undefined,
  });
  return isCancel(choice) ? null : choice;
}

export async function askMemberName(config: Config, ui: Ui = clackUi): Promise<string | null> {
  const name = await ui.text({
    message: 'Name of the new crew member (for example work or personal)',
    validate: (value) => {
      const typed = value?.trim() ?? '';
      if (!validName(typed)) return nameRule('crew member');
      if (config.members[typed]) return `Crew member ${typed} already exists`;
      return undefined;
    },
  });
  return isCancel(name) ? null : name.trim();
}

export async function askModelName(ui: Ui = clackUi): Promise<string | null> {
  const model = await ui.text({
    message: 'Model name (an alias or a full model name)',
    validate: (value) => (value?.trim() ? undefined : 'Type a model name'),
  });
  return isCancel(model) ? null : model.trim();
}

// Returns null when the user cancels at any step.
export async function pickChoice(config: Config, member: string, ui: Ui = clackUi): Promise<Choice | null> {
  const remembered = rememberedChoice(config, member);
  const models = MODELS.includes(remembered.model) ? MODELS : [...MODELS, remembered.model];
  let model = await ui.select({
    message: 'Model',
    options: [...models.map((value) => ({ value, label: optionLabel(value) })), { value: TYPE_A_NAME, label: 'Type a name' }],
    initialValue: remembered.model,
  });
  if (isCancel(model)) return null;
  if (model === TYPE_A_NAME) {
    const typed = await askModelName(ui);
    if (typed === null) return null;
    model = typed;
  }

  const effort = await ui.select({
    message: 'Effort',
    options: EFFORTS.map((value) => ({ value, label: optionLabel(value) })),
    initialValue: remembered.effort,
  });
  if (isCancel(effort)) return null;

  return { model, effort };
}

export const ISOLATED = 'isolated';

export interface Pick {
  member: string;
  choice: Choice; // choice.model is TYPE_A_NAME when the user wants to type one
  ship: string; // a ship name or ISOLATED
}

export interface MenuIO {
  input?: Readable;
  output?: Writable;
}

function cycle(values: string[], value: string, step: number): string {
  const at = values.indexOf(value);
  return values[(at + step + values.length) % values.length];
}

type Paint = ReturnType<typeof painter>['paint'];
const COLUMN_WIDTH = BAR_CELLS + 6;

// Block elements (U+2580 to U+259F), because VS Code's terminal keeps their colour out of its minimum contrast rule.
function usageBar(paint: Paint, pct: number | null): string {
  if (pct === null) return `${paint('empty', '▖'.repeat(BAR_CELLS))}  ${paint('faint', '   -')}`;
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * BAR_CELLS);
  const tone: Tone = pct < 60 ? 'green' : pct < 80 ? 'amber' : 'red'; // the widget's rule
  return `${paint(tone, '▖'.repeat(filled))}${paint('empty', '▖'.repeat(BAR_CELLS - filled))}  ${paint(tone, `${pct}%`.padStart(4))}`;
}

function memberUsage(paint: Paint, row: MemberRow): string {
  return row.quota ? `${usageBar(paint, row.quota.fiveHour)}     ${usageBar(paint, row.quota.week)}` : paint('faint', 'no reading yet');
}

function nameWidthOf(members: MemberRow[]): number {
  return Math.max('member'.length, ...members.map((row) => row.name.length));
}

function columnHeader(paint: Paint, nameWidth: number): string {
  return paint('faint', `     ${'member'.padEnd(nameWidth)}   ${'5h'.padEnd(COLUMN_WIDTH)}     week`);
}

// What crew quota prints: the menu's member rows, without the cursor or any marker.
export function quotaLines(config: Config, output: Writable): string[] {
  const { paint } = painter(output);
  const members = memberRows(config);
  const nameWidth = nameWidthOf(members);
  return [
    `${paint('text', 'crewrota', true)}  ${paint('faint', 'crew quota')}`,
    '',
    columnHeader(paint, nameWidth),
    ...members.map((row) => `     ${paint('text', row.name.padEnd(nameWidth), true)}   ${memberUsage(paint, row)}`),
  ];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function resetText(at: number | null, withDay: boolean): string {
  if (at === null) return '';
  const date = new Date(at * 1000);
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `  resets ${withDay ? `${WEEKDAYS[date.getDay()]} ` : ''}${clock}`;
}

export function menubarColour(pct: number): string {
  return PALETTE[pct < 60 ? 'green' : pct < 80 ? 'amber' : 'red'][0]; // the widget's rule
}

function windowLine(label: string, pct: number | null, reset: string): string {
  return pct === null ? `${label} -` : `${label} ${pct}%${reset} | color=${menubarColour(pct)}`;
}

// What crew quota --format menubar prints for SwiftBar and xbar: the bar text, then each member and two actions.
export function menubarLines(config: Config, now = Date.now()): string[] {
  const members = memberRows(config, now);
  const current = members.find((row) => row.current)?.quota?.fiveHour ?? null;
  const lines = [current === null ? 'crew' : `crew ${current}%`, '---'];
  if (members.length === 0) lines.push('No crew members yet');
  for (const row of members) {
    lines.push(row.current ? `${row.name} | font=Helvetica-Bold` : row.name);
    if (!row.quota) {
      lines.push('no reading yet');
      continue;
    }
    const resets = readResets(memberDir(row.name), now);
    lines.push(windowLine('5h', row.quota.fiveHour, resetText(resets.fiveHour, false)), windowLine('week', row.quota.week, resetText(resets.week, true)));
  }
  const cli = path.join(packageRoot, 'dist', 'cli.js');
  lines.push('---', `Open the crew menu | shell="${process.execPath}" param1="${cli}" terminal=true`, 'Refresh | refresh=true');
  return lines;
}

const SETTINGS = ['ship', 'model', 'effort'] as const;

// The one-screen menu: members with their 5-hour and week bars, then one line of ship, model and effort.
// Up and down (or 1 to 9) pick the member, tab picks the setting, left and right change it, enter starts.
// Needs at least one member. Returns the pick, ADD_MEMBER, or null when the user cancels.
export async function crewMenu(config: Config, io: MenuIO = {}): Promise<Pick | typeof ADD_MEMBER | null> {
  const output = io.output ?? process.stdout;
  const { paint, highlight } = painter(output);
  const members = memberRows(config);
  const ships = [ISOLATED, ...listShips(config)];
  const rows = [...members.map((row) => row.name), ADD_MEMBER];
  const savedShip = (member: string) => config.members[member]?.ship ?? ISOLATED;
  let cursor = Math.max(0, members.findIndex((row) => row.name === config.current));
  let marked = members[cursor].name;
  let choice = rememberedChoice(config, marked);
  let ship = savedShip(marked);
  let setting = 0;
  const modelValues = () => [...(MODELS.includes(choice.model) || choice.model === TYPE_A_NAME ? MODELS : [...MODELS, choice.model]), TYPE_A_NAME];
  const nameWidth = nameWidthOf(members);
  const lineWidth = 5 + nameWidth + 3 + COLUMN_WIDTH + 5 + COLUMN_WIDTH + 2;

  const line = (row: string, text: string) => (rows[cursor] === row ? highlight(text, lineWidth) : text);
  const memberLine = (row: MemberRow) => {
    const mark = row.name === marked ? paint('green', '›') : ' ';
    return line(row.name, `  ${mark}  ${paint('text', row.name.padEnd(nameWidth), true)}   ${memberUsage(paint, row)}`);
  };
  // The setting tab is on shows its arrows and the row background; the others show only their value.
  const field = (at: number, value: string) => {
    const shown = paint('text', value === TYPE_A_NAME ? 'type a name' : optionLabel(value), true);
    const label = paint('faint', SETTINGS[at]);
    if (at !== setting) return `${label}  ${shown}`;
    return `${label}  ${highlight(`${paint('text', '‹')} ${shown} ${paint('text', '›')}`, 0)}`;
  };
  const settingsLine = () => `     ${[field(0, ship), field(1, choice.model), field(2, choice.effort)].join('     ')}`;
  const mark = (name: string) => {
    marked = name;
    choice = rememberedChoice(config, marked);
    ship = savedShip(marked);
  };
  const addLine = () =>
    rows[cursor] === ADD_MEMBER
      ? line(ADD_MEMBER, `  ${paint('green', '›')}  ${paint('text', '+ Add a crew member')}`)
      : `     ${paint('faint', '+ Add a crew member')}`;
  const key = (keys: string, what: string, tone: Tone = 'text') => `${paint(tone, keys)} ${paint('faint', what)}`;
  const current = (): Pick | typeof ADD_MEMBER =>
    rows[cursor] === ADD_MEMBER ? ADD_MEMBER : { member: marked, choice: { ...choice }, ship };

  const prompt = new Prompt<Pick | typeof ADD_MEMBER>(
    {
      input: io.input,
      output,
      render() {
        const title = paint('text', 'crewrota', true);
        if (this.state === 'submit') {
          const picked = current();
          const text =
            picked === ADD_MEMBER
              ? 'add a crew member'
              : [picked.member, optionLabel(picked.choice.model), optionLabel(picked.choice.effort), `ship ${picked.ship}`].join('  ');
          return `\n${title}  ${paint('faint', text)}`;
        }
        if (this.state === 'cancel') return `\n${title}  ${paint('faint', 'closed')}`;
        return [
          '',
          `${title}  ${paint('faint', 'pick a crew member')}`,
          '',
          columnHeader(paint, nameWidth),
          ...members.map(memberLine),
          addLine(),
          '',
          settingsLine(),
          '',
          `  ${key('↑↓ 1-9', 'member', 'amber')}   ${key('tab', 'setting')}   ${key('←→', 'change')}   ${key('enter', 'start')}   ${key('esc', 'quit')}`,
          '',
        ].join('\n');
      },
    },
    false,
  );
  prompt.value = current();
  prompt.on('cursor', (action) => {
    if (action === 'up') cursor = Math.max(0, cursor - 1);
    if (action === 'down') cursor = Math.min(rows.length - 1, cursor + 1);
    if ((action === 'up' || action === 'down') && cursor < members.length) mark(members[cursor].name);
    if (action === 'left' || action === 'right') {
      const step = action === 'left' ? -1 : 1;
      if (SETTINGS[setting] === 'ship') ship = cycle(ships, ship, step);
      if (SETTINGS[setting] === 'model') choice.model = cycle(modelValues(), choice.model, step);
      if (SETTINGS[setting] === 'effort') choice.effort = cycle(EFFORTS, choice.effort, step);
    }
    prompt.value = current();
  });
  prompt.on('key', (char, info) => {
    if (info?.name === 'tab') setting = (setting + (info.shift ? SETTINGS.length - 1 : 1)) % SETTINGS.length;
    const number = Number(char);
    if (char && /^[1-9]$/.test(char) && number <= members.length) {
      cursor = number - 1;
      mark(members[cursor].name);
    }
    prompt.value = current();
  });
  const result = await prompt.prompt();
  return isCancel(result) || result === undefined ? null : result;
}

export async function askYesNo(message: string, initialValue: boolean, ui: Ui = clackUi): Promise<boolean | null> {
  const answer = await ui.confirm({ message, initialValue });
  return isCancel(answer) ? null : answer;
}

// Returns {} for isolated, { ship } to share through a ship, or null when the user cancels.
export async function askShareHistory(ships: string[], ui: Ui = clackUi): Promise<{ ship?: string } | null> {
  const options = [
    { value: 'isolated', label: 'Keep isolated', hint: 'this member sees only its own history' },
    ...(ships.length > 0 ? [{ value: 'link', label: 'Join an existing ship' }] : []),
    { value: 'create', label: 'Create a ship' },
  ];
  const how = await ui.select({ message: 'Share history with other members?', options, initialValue: 'isolated' });
  if (isCancel(how)) return null;
  if (how === 'isolated') return {};
  if (how === 'link') {
    const ship = await ui.select({ message: 'Ship', options: ships.map((value) => ({ value, label: value })) });
    return isCancel(ship) ? null : { ship };
  }
  const ship = await ui.text({
    message: 'Name of the new ship',
    validate: (value) => {
      const typed = value?.trim() ?? '';
      if (!validName(typed)) return nameRule('ship');
      if (ships.includes(typed)) return `Ship ${typed} already exists; pick "Join an existing ship" instead`;
      return undefined;
    },
  });
  return isCancel(ship) ? null : { ship: ship.trim() };
}

// D14: asked once, at the first launch, then remembered.
export async function askSkipPermissions(ui: Ui = clackUi): Promise<boolean | null> {
  ui.note(
    [
      '--dangerously-skip-permissions skips every permission prompt in Claude Code.',
      'The agent then edits files and runs commands without asking you first.',
      'crewrota asks once and remembers. Change it with `crew config permissions on|off`.',
    ].join('\n'),
    'Skip permission prompts?',
  );
  return askYesNo('Start sessions with --dangerously-skip-permissions?', false, ui);
}
