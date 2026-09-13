import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string): string {
  if (password.length < 12) throw new Error('App-Passwort muss mindestens 12 Zeichen haben.');
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, salt, digest] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !digest || !/^[a-f0-9]{128}$/.test(digest)) throw new Error('APP_PASSWORD_HASH ist ungültig; npm run setup erneut ausführen.');
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(digest, 'hex'));
}
export function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function randomToken(): string { return randomBytes(32).toString('hex'); }
export function encrypt(value: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64')).join('.');
}
export function decrypt(value: string, key: string): string {
  const parts = value.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new Error('Verschlüsseltes Secret hat ein ungültiges Format.');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(parts[0], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[1], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64')), decipher.final()]).toString('utf8');
}
