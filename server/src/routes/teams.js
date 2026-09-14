import { Router } from 'express';
import db, { logActivity } from '../db.js';
import { authenticate, requireLead } from '../auth.js';

const r = Router();
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

r.get('/teams', authenticate, (req, res) => {
  const cycle = req.query.cycle || null;
  const teams = db.prepare('SELECT * FROM teams ORDER BY sort_order, name').all();
  const stats = db.prepare(`
    SELECT team_id,
           COUNT(*)                                                   AS total,
           SUM(status = 'Completed')                                  AS completed,
           SUM(status = 'In Progress')                                AS in_progress,
           SUM(status = 'Blocked')                                    AS blocked,
           SUM(status NOT IN ('Completed','Cancelled')
               AND end_date IS NOT NULL AND date(end_date) < date('now')) AS overdue
    FROM tasks WHERE (? IS NULL OR cycle = ?) GROUP BY team_id
  `).all(cycle, cycle);
  const members = db.prepare(
    'SELECT team_id, COUNT(*) AS n FROM users WHERE active = 1 GROUP BY team_id'
  ).all();

  res.json(teams.map((t) => {
    const s = stats.find((x) => x.team_id === t.id) || {};
    const total = s.total || 0;
    return {
      ...t,
      member_count: members.find((m) => m.team_id === t.id)?.n || 0,
      total_tasks: total,
      completed_tasks: s.completed || 0,
      in_progress_tasks: s.in_progress || 0,
      blocked_tasks: s.blocked || 0,
      overdue_tasks: s.overdue || 0,
      completion_rate: total ? Math.round(((s.completed || 0) / total) * 100) : 0,
    };
  }));
});

r.post('/teams', authenticate, requireLead, (req, res) => {
  const { name, description = '', colour = '#4f46e5', sort_order = 99 } = req.body;
  if (!name) return res.status(400).json({ error: 'Team name is required' });
  if (db.prepare('SELECT 1 FROM teams WHERE lower(name) = lower(?)').get(name)) {
    return res.status(409).json({ error: 'A team with that name already exists' });
  }
  const info = db.prepare(
    'INSERT INTO teams (name, slug, description, colour, sort_order) VALUES (?,?,?,?,?)'
  ).run(name, slugify(name), description, colour, sort_order);
  logActivity({ user_id: req.user.id, action: 'team.created', detail: name });
  res.status(201).json(db.prepare('SELECT * FROM teams WHERE id = ?').get(info.lastInsertRowid));
});

r.put('/teams/:id', authenticate, requireLead, (req, res) => {
  const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Team not found' });
  const f = { ...t, ...req.body };
  db.prepare('UPDATE teams SET name=?, slug=?, description=?, colour=?, sort_order=? WHERE id=?')
    .run(f.name, slugify(f.name), f.description, f.colour, f.sort_order, t.id);
  res.json(db.prepare('SELECT * FROM teams WHERE id = ?').get(t.id));
});

r.delete('/teams/:id', authenticate, requireLead, (req, res) => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE team_id = ?').get(req.params.id).n;
  if (n > 0) return res.status(400).json({ error: `This team still has ${n} task(s). Move or delete them first.` });
  db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default r;
