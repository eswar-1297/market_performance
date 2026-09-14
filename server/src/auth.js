import jwt from 'jsonwebtoken';
import db from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'cloudfuze-marketing-performance-tracker-local-dev';

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

/** Attaches req.user when a valid bearer token is present. */
export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Account no longer active' });
    req.user = publicUser(user);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}

/** Only the marketing lead (admin). */
export function requireLead(req, res, next) {
  if (req.user?.role !== 'lead') {
    return res.status(403).json({ error: 'Only the marketing lead can do this' });
  }
  next();
}

/** Anyone who can change data: lead or member (stakeholders are read-only). */
export function requireWriter(req, res, next) {
  if (req.user?.role === 'stakeholder') {
    return res.status(403).json({ error: 'Stakeholder access is read-only' });
  }
  next();
}

export const isLead = (req) => req.user?.role === 'lead';
