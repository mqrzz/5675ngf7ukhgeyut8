// Шифрование токена бота — AES-256-GCM. Ключ — 32 байта в hex, в .env как TOKEN_ENCRYPTION_KEY.
import crypto from 'node:crypto';

const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex');

export function encryptToken(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // храним как один BYTEA: iv(12) + authTag(16) + ciphertext
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptToken(buf) {
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
