import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from './paths.js';

export const templateDir = path.join(packageRoot, 'templates', 'dot-claude');

function templateFiles(dir = templateDir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? templateFiles(file) : [path.relative(templateDir, file)];
  });
}

// Writes the root .claude/ into folder; an existing file is never overwritten.
export function initProject(folder: string): { created: string[]; kept: string[] } {
  const created: string[] = [];
  const kept: string[] = [];
  for (const rel of templateFiles().sort()) {
    const target = path.join(folder, '.claude', rel);
    const shown = path.join('.claude', rel);
    if (fs.existsSync(target)) {
      kept.push(`${shown} (already there)`);
    } else if (rel === 'CLAUDE.md' && fs.existsSync(path.join(folder, 'CLAUDE.md'))) {
      kept.push(`${shown} (the project has a CLAUDE.md)`);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(templateDir, rel), target, fs.constants.COPYFILE_EXCL);
      created.push(shown);
    }
  }
  return { created, kept };
}
