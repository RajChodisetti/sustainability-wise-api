import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { AppError, badRequest } from '../utils/errors.js';

export type EncryptedClientCredential = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

function credentialKey(secret = config.wattwatchersClientCredentials.encryptionSecret): Buffer {
  if (!secret.trim()) {
    throw new AppError(
      503,
      'Wattwatchers client credential storage is unavailable',
      'WATTWATCHERS_CLIENT_KEY_ENCRYPTION_SECRET is not configured',
    );
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

function credentialValue(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('apiKey must be a string');
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 4096) {
    throw badRequest('apiKey must contain between 8 and 4096 characters');
  }
  return trimmed;
}

export function encryptWattwatchersClientKey(
  clientId: string,
  apiKey: unknown,
  secret?: string,
): EncryptedClientCredential {
  const value = credentialValue(apiKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', credentialKey(secret), iv);
  cipher.setAAD(Buffer.from(clientId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: 1,
  };
}

export function decryptWattwatchersClientKey(
  clientId: string,
  encrypted: Pick<EncryptedClientCredential, 'ciphertext' | 'iv' | 'authTag' | 'keyVersion'>,
  secret?: string,
): string {
  if (encrypted.keyVersion !== 1) {
    throw new AppError(503, 'Wattwatchers client credential cannot be opened', 'Unsupported credential key version');
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      credentialKey(secret),
      Buffer.from(encrypted.iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(clientId, 'utf8'));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'Wattwatchers client credential cannot be opened', 'Credential authentication failed');
  }
}
