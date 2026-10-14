import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { one, q } from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'cloudfuze-marketing-performance-tracker-local-dev';

// The whole team signs in with this one account. Everybody else is a person on
// the sheet, not a login.
export const SHARED_EMAIL = (process.env.SHARED_LOGIN_EMAIL || 'marketing@cloudfuze.com').toLowerCase();
const SHARED_PASSWORD = process.env.SHARED_LOGIN_PASSWORD || 'Cloudfuze@123';

/** Creates the shared account on first boot; later boots keep its password. */
export async function ensureSharedLogin() {
  const found = await one('SELECT id FROM users WHERE lower(email) = $1', [SHARED_EMAIL]);
  if (found) {
    await q(`UPDATE users SET role = 'lead', active = TRUE, team_id = NULL WHERE id = $1`, [found.id]);
    return;
  }
  await q(
    `INSERT INTO users (name, email, password_hash, role, designation)
     VALUES ('Marketing Team', $1, $2, 'lead', 'Shared login')`,
    [SHARED_EMAIL, bcrypt.hashSync(SHARED_PASSWORD, 10)],
  );
  console.log(`  Shared login created: ${SHARED_EMAIL}`);
}

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

/** Attaches req.user when a valid bearer token is present. */
export async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await one('SELECT * FROM users WHERE id = $1 AND active', [payload.id]);
    if (!user) return res.status(401).json({ error: 'Account no longer active' });
    // Sessions from before the shared login are signed out.
    if (user.email.toLowerCase() !== SHARED_EMAIL) {
      return res.status(401).json({ error: `Sign in with ${SHARED_EMAIL}` });
    }
    req.user = publicUser(user);
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}

/** Only the marketing lead (admin). */
export function requireLead(req, res, next) {
  if (req.user?.role !== 'lead') {
    return res.status(403).json({ error: 'Only the marketing lead can do this' });
  }
  return next();
}

/** Anyone who can change data: lead or member (stakeholders are read-only). */
export function requireWriter(req, res, next) {
  if (req.user?.role === 'stakeholder') {
    return res.status(403).json({ error: 'Stakeholder access is read-only' });
  }
  return next();
}

export const isLead = (req) => req.user?.role === 'lead';
