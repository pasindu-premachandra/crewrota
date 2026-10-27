const NAME = /^[a-z][a-z0-9-]{0,31}$/;

export function validName(name: string): boolean {
  return NAME.test(name);
}

export function nameRule(kind: 'crew member' | 'ship' | 'shortcut'): string {
  return `A ${kind} name uses lowercase letters, digits and hyphens, starts with a letter, and is at most 32 characters.`;
}

export function checkName(kind: 'crew member' | 'ship' | 'shortcut', name: string): void {
  if (!validName(name)) throw new Error(`"${name}" is not a valid ${kind} name. ${nameRule(kind)}`);
}
