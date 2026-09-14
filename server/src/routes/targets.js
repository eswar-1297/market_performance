import { Router } from 'express';
import db, { logActivity } from '../db.js';
import { authenticate, requireWriter, requireLead, isLead } from '../auth.js';

const r = Router();

const STATUSES = ['Not Started', 'On Track', 'At Risk', 'Off Track', 'Achieved'];

const SELECT_TARGET = `
  SELECT g.*,
         u.name AS owner_name, u.designation AS owner_designation,
         tm.name AS team_name, tm.colour AS team_colour,
         (SELECT COUNT(*) FROM tasks t WHERE t.target_id = g.id) AS task_count,
         (SELECT COUNT(*) FROM tasks t WHERE t.target_id = g.id AND t.status = 'Completed') AS task_done,
         (SELECT COUNT(*) FROM attachments a WHERE a.target_id = g.id) AS attachment_count
  FROM targets g
  LEFT JOIN users u  ON u.id  = g.owner_id
  LEFT JOIN teams tm ON tm.id = g.team_id`;

/**
 * Progress for a metric target, honouring direction.
 * up:   baseline 111 -> target 120, current 118  =>  (118-111)/(120-111) = 78%
 * down: baseline 537 -> target 470, current 500  =>  (537-500)/(537-470) = 55%
 */
export function metricProgress(t) {
  if (t.kind !== 'metric') return null;
  const { baseline, target_value, current_value } = t;
  if (target_value == null || current_value == null) return null;
  const base = baseline == null ? 0 : baseline;
  const span = target_value - base;
  if (span === 0) return current_value === target_value ? 100 : 0;
  const pct = ((current_value - base) / span) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function decorate(t) {
  return { ...t, progress_pct: metricProgress(t) };
}

r.get('/targets', authenticate, (req, res) => {
  const { cycle, team_id, owner_id, kind, status } = req.query;
  const where = [];
  const args = [];
  if (cycle) { where.push('g.cycle = ?'); args.push(cycle); }
  if (team_id) { where.push('g.team_id = ?'); args.push(team_id); }
  if (owner_id) { where.push('g.owner_id = ?'); args.push(owner_id); }
  if (kind) { where.push('g.kind = ?'); args.push(kind); }
  if (status) { where.push('g.status = ?'); args.push(status); }
  const sql = `${SELECT_TARGET} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY tm.sort_order, g.kind = 'narrative', g.id`;
  res.json(db.prepare(sql).all(...args).map(decorate));
});

r.get('/targets/:id', authenticate, (req, res) => {
  const t = db.prepare(`${SELECT_TARGET} WHERE g.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Target not found' });
  t.tasks = db.prepare(
    `SELECT t.id, t.title, t.status, t.progress, t.end_date, u.name AS assignee_name
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.target_id = ? ORDER BY t.end_date`).all(t.id);
  t.attachments = db.prepare(
    `SELECT a.*, u.name AS uploaded_by_name FROM attachments a
     LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.target_id = ? ORDER BY a.created_at DESC`).all(t.id);
  res.json(decorate(t));
});

r.post('/targets', authenticate, requireLead, (req, res) => {
  const b = req.body;
  if (!b.title) return res.status(400).json({ error: 'Target title is required' });
  if (!b.cycle) return res.status(400).json({ error: 'Target month (cycle) is required' });
  const info = db.prepare(`
    INSERT INTO targets (title, detail, team_id, owner_id, cycle, kind, metric_name, unit,
                         baseline, target_value, current_value, direction, status, source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(b.title, b.detail || '', b.team_id || null, b.owner_id || null, b.cycle,
    b.kind === 'metric' ? 'metric' : 'narrative', b.metric_name || '', b.unit || '',
    b.baseline ?? null, b.target_value ?? null, b.current_value ?? null,
    b.direction === 'down' ? 'down' : 'up',
    STATUSES.includes(b.status) ? b.status : 'Not Started', b.source || '');
  logActivity({ target_id: info.lastInsertRowid, user_id: req.user.id, action: 'target.created', detail: b.title });
  res.status(201).json(decorate(db.prepare(`${SELECT_TARGET} WHERE g.id = ?`).get(info.lastInsertRowid)));
});

r.put('/targets/:id', authenticate, requireWriter, (req, res) => {
  const t = db.prepare('SELECT * FROM targets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Target not found' });
  // The owner can report the current value; only the lead can change the goal itself.
  const OWNER_FIELDS = ['current_value', 'status', 'detail'];
  const mayEditAll = isLead(req);
  if (!mayEditAll && t.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only update targets you own' });
  }
  const patch = mayEditAll
    ? req.body
    : Object.fromEntries(Object.entries(req.body).filter(([k]) => OWNER_FIELDS.includes(k)));
  const f = { ...t, ...patch };
  if (!STATUSES.includes(f.status)) return res.status(400).json({ error: 'Unknown target status' });

  db.prepare(`
    UPDATE targets SET title=?, detail=?, team_id=?, owner_id=?, cycle=?, kind=?, metric_name=?,
      unit=?, baseline=?, target_value=?, current_value=?, direction=?, status=?, source=?
    WHERE id=?`
  ).run(f.title, f.detail || '', f.team_id || null, f.owner_id || null, f.cycle, f.kind,
    f.metric_name || '', f.unit || '', f.baseline ?? null, f.target_value ?? null,
    f.current_value ?? null, f.direction, f.status, f.source || '', t.id);

  if (t.status !== f.status) {
    logActivity({
      target_id: t.id, user_id: req.user.id, action: 'target.status',
      detail: `${t.status} -> ${f.status}`,
    });
  }
  res.json(decorate(db.prepare(`${SELECT_TARGET} WHERE g.id = ?`).get(t.id)));
});

r.delete('/targets/:id', authenticate, requireLead, (req, res) => {
  db.prepare('DELETE FROM targets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/** Copy a month's targets forward, e.g. roll September into October. */
r.post('/targets/roll-forward', authenticate, requireLead, (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'Both "from" and "to" months are required' });
  const rows = db.prepare('SELECT * FROM targets WHERE cycle = ?').all(from);
  if (!rows.length) return res.status(400).json({ error: `No targets found for ${from}` });
  const insert = db.prepare(`
    INSERT INTO targets (title, detail, team_id, owner_id, cycle, kind, metric_name, unit,
                         baseline, target_value, current_value, direction, status, source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const run = db.transaction(() => {
    for (const t of rows) {
      // last month's achieved value becomes this month's baseline
      insert.run(t.title, t.detail, t.team_id, t.owner_id, to, t.kind, t.metric_name, t.unit,
        t.current_value ?? t.baseline, t.target_value, null, t.direction,
        'Not Started', `Rolled forward from ${from}`);
    }
  });
  run();
  res.json({ ok: true, copied: rows.length });
});

export default r;
