import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SESSION_DAYS = 30;

export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const key = await scryptAsync(password, salt, 64);
  return { salt, hash: key.toString('hex') };
}

export async function verifyPassword(password, salt, hash) {
  const key = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === key.length && timingSafeEqual(key, expected);
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export function userFromToken(db, token) {
  if (!token) return null;
  return (
    db.prepare(
      `SELECT u.id, u.username, u.bonus_cash AS bonus FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    ).get(token, Date.now()) || null
  );
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Prosty limit nieudanych logowań: max 10 prób na 15 minut na konto z jednego adresu.
// Klucz zawiera login, żeby za wspólnym proxy (hosting) jedna osoba nie blokowała logowania wszystkim.
const failures = new Map();
export function loginBlocked(ip) {
  const f = failures.get(ip);
  return f && f.count >= 10 && Date.now() - f.since < 15 * 60e3;
}
export function recordLoginFailure(ip) {
  const f = failures.get(ip);
  if (failures.size > 10_000) {
    for (const [k, v] of failures) if (Date.now() - v.since > 15 * 60e3) failures.delete(k);
  }
  if (!f || Date.now() - f.since > 15 * 60e3) failures.set(ip, { count: 1, since: Date.now() });
  else f.count++;
}
export function clearLoginFailures(ip) {
  failures.delete(ip);
}
