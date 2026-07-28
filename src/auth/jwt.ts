import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export type App = 'ecoaudit' | 'solarsense' | 'installhub' | 'wattwatchers';
export type Role = 'admin' | 'inspector' | 'viewer' | 'service_account';

export interface AccessPayload {
  userId: string;
  app: App;
  role: Role;
}

export interface RefreshPayload {
  userId: string;
  app: App;
}

const ACCESS_TTL = '15m';
const REFRESH_TTL = '30d';

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: ACCESS_TTL });
}

export function signRefreshToken(payload: RefreshPayload): string {
  // A unique JWT ID prevents two refresh tokens issued for the same user in
  // the same second from becoming byte-for-byte identical. Existing tokens
  // without a jti remain valid until their normal expiry.
  return jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: REFRESH_TTL,
    jwtid: randomUUID(),
  });
}

export function verifyAccessToken(token: string): AccessPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as AccessPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshPayload | null {
  try {
    return jwt.verify(token, config.jwtRefreshSecret) as RefreshPayload;
  } catch {
    return null;
  }
}
