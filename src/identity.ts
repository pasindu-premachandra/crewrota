import fs from 'node:fs';
import path from 'node:path';

export interface Identity {
  email: string;
  organization: string;
  organizationUuid: string;
}

// Same fields claude-swap 0.28.0 reads from .claude.json (switcher.py:3189-3195, 3655-3657).
export function readIdentity(dir: string): Identity | null {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'));
  } catch {
    return null;
  }
  const account = data?.oauthAccount;
  if (!account?.emailAddress) return null;
  return {
    email: account.emailAddress,
    organization: account.organizationName || '',
    organizationUuid: account.organizationUuid || '',
  };
}

export function organizationLabel(identity: Identity): string {
  return identity.organization || 'personal';
}

export function describeIdentity(identity: Identity | null): string {
  return identity ? `${identity.email} (${organizationLabel(identity)})` : 'no login found';
}

export function sameIdentity(a: Identity, b: Identity): boolean {
  return a.email === b.email && a.organizationUuid === b.organizationUuid;
}
