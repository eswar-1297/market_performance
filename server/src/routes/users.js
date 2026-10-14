import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, one, logActivity } from '../db.js';
import crypto from 'node:crypto';
import { authenticate, requireLead, signToken, publicUser, SHARED_EMAIL } from '../auth.js';

const r = Router();

/* ---------------- auth ---------------- */

r.post('/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (email !== SHARED_EMAIL) {
      return res.status(401).json({ error: `Everyone signs in with ${SHARED_EMAIL}` });
    }
    const user = await one('SELECT * FROM users WHERE lower(email) = $1', [email]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }
    if (!user.active) return res.status(403).json({ error: 'This account has been deactivated' });
    return res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) { return next(e); }
});

r.get('/auth/me', authenticate, (req, res) => res.json({ user: req.user }));

r.post('/auth/password', authenticate, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const row = await one('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!bcrypt.compareSync(String(current_password || ''), row.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    await q('UPDATE users SET password_hash = $1 WHERE id = $2',
      [bcrypt.hashSync(new_password, 10), req.user.id]);
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

/* ---------------- members ---------------- */

const SELECT_USERS = `
  SELECT u.*, t.name AS team_name, t.colour AS team_colour
  FROM users u LEFT JOIN teams t ON t.id = u.team_id`;

r.get('/users', authenticate, async (req, res, next) => {
  try {
    const { team_id, include_inactive } = req.query;
    // The shared login is not a person, so it is never listed.
    const args = [SHARED_EMAIL];
    const where = ['lower(u.email) <> $1'];
    if (team_id) { args.push(team_id); where.push(`u.team_id = $${args.length}`); }
    if (!include_inactive) where.push('u.active');
    const sql = `${SELECT_USERS} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY t.sort_order NULLS LAST, (u.role = 'lead') DESC, u.name`;
    const rows = await q(sql, args);
    return res.json(rows.map(publicUser));
  } catch (e) { return next(e); }
});

r.post('/users', authenticate, requireLead, async (req, res, next) => {
  try {
    const {
      name, email, role = 'member', designation = '', team_id = null, reports_to = '',
    } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    // People do not sign in themselves; the column still wants a hash.
    const password = req.body.password || crypto.randomBytes(24).toString('hex');
    const taken = await one('SELECT 1 FROM users WHERE lower(email) = $1', [String(email).toLowerCase()]);
    if (taken) return res.status(409).json({ error: 'A member with that email already exists' });

    const created = await one(
      `INSERT INTO users (name, email, password_hash, role, designation, team_id, reports_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [name, String(email).toLowerCase(), bcrypt.hashSync(password, 10), role, designation,
        team_id || null, reports_to],
    );
    await logActivity({ user_id: req.user.id, action: 'member.created', detail: `${name} (${role})` });
    return res.status(201).json(publicUser(await one(`${SELECT_USERS} WHERE u.id = $1`, [created.id])));
  } catch (e) { return next(e); }
});

r.put('/users/:id', authenticate, requireLead, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one('SELECT * FROM users WHERE id = $1', [id]);
    if (!existing) return res.status(404).json({ error: 'Member not found' });
    const f = { ...existing, ...req.body };
    await q(
      `UPDATE users SET name=$1, email=$2, role=$3, designation=$4, team_id=$5, reports_to=$6, active=$7
       WHERE id=$8`,
      [f.name, String(f.email).toLowerCase(), f.role, f.designation, f.team_id || null,
        f.reports_to, !!f.active, id],
    );
    if (req.body.password) {
      await q('UPDATE users SET password_hash = $1 WHERE id = $2',
        [bcrypt.hashSync(req.body.password, 10), id]);
    }
    await logActivity({ user_id: req.user.id, action: 'member.updated', detail: f.name });
    return res.json(publicUser(await one(`${SELECT_USERS} WHERE u.id = $1`, [id])));
  } catch (e) { return next(e); }
});

r.delete('/users/:id', authenticate, requireLead, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account' });
    await q('UPDATE users SET active = FALSE WHERE id = $1', [id]);
    await logActivity({ user_id: req.user.id, action: 'member.deactivated', detail: `user #${id}` });
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

export default r;
