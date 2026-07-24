import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { App, Role } from './jwt.js';

const SALT_ROUNDS = 10;

export function generateKey(app: App): { raw: string; prefix: string; hashed: Promise<string> } {
  const appCode: Record<App, string> = {
    ecoaudit: 'ea',
    solarsense: 'ss',
    installhub: 'ih',
    wattwatchers: 'ww',
  };
  const secret = randomBytes(24).toString('hex');
  const prefix = `sk_${appCode[app]}_live_`;
  const raw = `${prefix}${secret}`;
  return { raw, prefix, hashed: bcrypt.hash(raw, SALT_ROUNDS) };
}

export async function hashKey(raw: string): Promise<string> {
  return bcrypt.hash(raw, SALT_ROUNDS);
}

export async function verifyKey(raw: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(raw, hashed);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(password, hashed);
}
