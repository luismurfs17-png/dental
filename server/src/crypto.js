import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';

function deriveKey() {
  return createHash('sha256').update(config.jwtSecret).digest();
}

export function encryptSecret(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === '') return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(payload) {
  if (!payload) return null;
  try {
    const parts = String(payload).split(':');
    if (parts.length !== 3) return null;
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(parts[0], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[1], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}