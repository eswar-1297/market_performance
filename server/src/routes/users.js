import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db, { logActivity } from '../db.js';
import { authenticate, requireLead, signToken, publicUser } from '../auth.js';

const r = Router();

/* ---------------- auth ---------------- */

r.post('/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  if (!user.active) return res.status(403).json({ error: 'This account has been deactivated' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

r.get('/auth/me', authenticate, (req, res) => res.json({ user: req.user }));

r.post('/auth/password', authenticate, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(current_password || ''), row.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ ok: true });
});

/* ---------------- members ---------------- */

const SELECT_USERS = `
  SELECT u.*, t.name AS team_name, t.colour AS team_colour
  FROM users u LEFT JOIN teams t ON t.id = u.team_id`;

r.get('/users', authenticate, (req, res) => {
  const { team_id, include_inactive } = req.query;
  const where = [];
  const args = [];
  if (team_id) { where.push('u.team_id = ?'); args.push(team_id); }
  if (!include_inactive) where.push('u.active = 1');
  const sql = `${SELECT_USERS} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY t.sort_order, u.role = 'lead' DESC, u.name`;
  res.json(db.prepare(sql).all(...args).map(publicUser));
});

r.post('/users', authenticate, requireLead, (req, res) => {
  const { name, email, password, role = 'member', designation = '', team_id = null, reports_to = '' } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(String(email).toLowerCase())) {
    return res.status(409).json({ error: 'A member with that email already exists' });
  }
  const info = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, designation, team_id, reports_to)
     VALUES (?,?,?,?,?,?,?)`
  ).run(name, String(email).toLowerCase(), bcrypt.hashSync(password, 10), role, designation, team_id || null, reports_to);
  logActivity({ user_id: req.user.id, action: 'member.created', detail: `${name} (${role})` });
  res.status(201).json(publicUser(db.prepare(`${SELECT_USERS} WHERE u.id = ?`).get(info.lastInsertRowid)));
});

r.put('/users/:id', authenticate, requireLead, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Member not found' });
  const f = { ...existing, ...req.body };
  db.prepare(
    `UPDATE users SET name=?, email=?, role=?, designation=?, team_id=?, reports_to=?, active=? WHERE id=?`
  ).run(f.name, String(f.email).toLowerCase(), f.role, f.designation, f.team_id || null,
        f.reports_to, f.active ? 1 : 0, id);
  if (req.body.password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(req.body.password, 10), id);
  }
  logActivity({ user_id: req.user.id, action: 'member.updated', detail: f.name });
  res.json(publicUser(db.prepare(`${SELECT_USERS} WHERE u.id = ?`).get(id)));
});

r.delete('/users/:id', authenticate, requireLead, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account' });
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
  logActivity({ user_id: req.user.id, action: 'member.deactivated', detail: `user #${id}` });
  res.json({ ok: true });
});

export default r;
