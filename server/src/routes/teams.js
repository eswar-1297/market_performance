import { Router } from 'express';
import { q, one, logActivity } from '../db.js';
import { authenticate, requireLead } from '../auth.js';

const r = Router();
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

r.get('/teams', authenticate, async (req, res, next) => {
  try {
    const teams = await q('SELECT * FROM teams ORDER BY sort_order, name');
    const members = await q(
      'SELECT team_id, COUNT(*)::int AS n FROM users WHERE active GROUP BY team_id',
    );
    return res.json(teams.map((t) => ({
      ...t,
      member_count: members.find((m) => m.team_id === t.id)?.n || 0,
    })));
  } catch (e) { return next(e); }
});

r.post('/teams', authenticate, requireLead, async (req, res, next) => {
  try {
    const { name, description = '', colour = '#4f46e5', sort_order = 99 } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name is required' });
    const taken = await one('SELECT 1 FROM teams WHERE lower(name) = lower($1)', [name]);
    if (taken) return res.status(409).json({ error: 'A team with that name already exists' });
    const created = await one(
      `INSERT INTO teams (name, slug, description, colour, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, slugify(name), description, colour, sort_order],
    );
    await logActivity({ user_id: req.user.id, action: 'team.created', detail: name });
    return res.status(201).json(created);
  } catch (e) { return next(e); }
});

r.put('/teams/:id', authenticate, requireLead, async (req, res, next) => {
  try {
    const t = await one('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Team not found' });
    const f = { ...t, ...req.body };
    const saved = await one(
      'UPDATE teams SET name=$1, slug=$2, description=$3, colour=$4, sort_order=$5 WHERE id=$6 RETURNING *',
      [f.name, slugify(f.name), f.description, f.colour, f.sort_order, t.id],
    );
    return res.json(saved);
  } catch (e) { return next(e); }
});

r.delete('/teams/:id', authenticate, requireLead, async (req, res, next) => {
  try {
    const t = await one('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Team not found' });
    await q('DELETE FROM teams WHERE id = $1', [t.id]);
    await logActivity({ user_id: req.user.id, action: 'team.deleted', detail: t.name });
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

export default r;
