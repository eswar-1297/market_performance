import { Router } from 'express';
import db, { logActivity } from '../db.js';
import { authenticate, requireWriter, isLead } from '../auth.js';

const r = Router();

const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'In Review', 'Completed', 'Cancelled'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

const SELECT_TASK = `
  SELECT t.*,
         u.name AS assignee_name, u.designation AS assignee_designation,
         c.name AS created_by_name,
         tm.name AS team_name, tm.colour AS team_colour,
         g.title AS target_title,
         (SELECT COUNT(*) FROM attachments a WHERE a.task_id = t.id) AS attachment_count,
         (SELECT COUNT(*) FROM comments  m WHERE m.task_id = t.id) AS comment_count,
         (t.status NOT IN ('Completed','Cancelled') AND t.end_date IS NOT NULL
            AND date(t.end_date) < date('now')) AS is_overdue
  FROM tasks t
  LEFT JOIN users u   ON u.id  = t.assignee_id
  LEFT JOIN users c   ON c.id  = t.created_by
  LEFT JOIN teams tm  ON tm.id = t.team_id
  LEFT JOIN targets g ON g.id  = t.target_id`;

/** Members may only touch their own tasks; the lead may touch everything. */
function canEdit(req, task) {
  if (isLead(req)) return true;
  return req.user.role === 'member' && task.assignee_id === req.user.id;
}

r.get('/tasks', authenticate, (req, res) => {
  const { team_id, assignee_id, status, priority, cycle, target_id, q, overdue, mine } = req.query;
  const where = [];
  const args = [];
  if (team_id) { where.push('t.team_id = ?'); args.push(team_id); }
  if (assignee_id) { where.push('t.assignee_id = ?'); args.push(assignee_id); }
  if (mine === '1') { where.push('t.assignee_id = ?'); args.push(req.user.id); }
  if (status) { where.push('t.status = ?'); args.push(status); }
  if (priority) { where.push('t.priority = ?'); args.push(priority); }
  if (cycle) { where.push('t.cycle = ?'); args.push(cycle); }
  if (target_id) { where.push('t.target_id = ?'); args.push(target_id); }
  if (q) {
    where.push('(t.title LIKE ? OR t.description LIKE ? OR t.result LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (overdue === '1') {
    where.push(`t.status NOT IN ('Completed','Cancelled') AND t.end_date IS NOT NULL AND date(t.end_date) < date('now')`);
  }
  const sql = `${SELECT_TASK} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE t.status WHEN 'Blocked' THEN 0 WHEN 'In Progress' THEN 1 WHEN 'In Review' THEN 2
                           WHEN 'Not Started' THEN 3 WHEN 'Completed' THEN 4 ELSE 5 END,
             CASE t.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
             date(t.end_date) IS NULL, date(t.end_date)`;
  res.json(db.prepare(sql).all(...args));
});

r.get('/tasks/:id', authenticate, (req, res) => {
  const task = db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  task.attachments = db.prepare(
    `SELECT a.*, u.name AS uploaded_by_name FROM attachments a
     LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.task_id = ? ORDER BY a.created_at DESC`).all(task.id);
  task.comments = db.prepare(
    `SELECT c.*, u.name AS author_name FROM comments c
     LEFT JOIN users u ON u.id = c.user_id
     WHERE c.task_id = ? ORDER BY c.created_at`).all(task.id);
  task.activity = db.prepare(
    `SELECT a.*, u.name AS user_name FROM activity a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.task_id = ? ORDER BY a.created_at DESC LIMIT 50`).all(task.id);
  task.can_edit = canEdit(req, task);
  res.json(task);
});

r.post('/tasks', authenticate, requireWriter, (req, res) => {
  const b = req.body;
  if (!b.title) return res.status(400).json({ error: 'Task title is required' });
  if (!isLead(req) && b.assignee_id && Number(b.assignee_id) !== req.user.id) {
    return res.status(403).json({ error: 'You can only create tasks for yourself' });
  }
  if (b.start_date && b.end_date && b.end_date < b.start_date) {
    return res.status(400).json({ error: 'End date cannot be before the start date' });
  }
  const cycle = b.cycle || (b.end_date || b.start_date || new Date().toISOString()).slice(0, 7);
  const info = db.prepare(`
    INSERT INTO tasks (title, description, team_id, assignee_id, created_by, target_id,
                       start_date, end_date, status, priority, progress, estimated_hours,
                       category, cycle, impact)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(b.title, b.description || '', b.team_id || null,
    b.assignee_id || (isLead(req) ? null : req.user.id), req.user.id, b.target_id || null,
    b.start_date || null, b.end_date || null,
    STATUSES.includes(b.status) ? b.status : 'Not Started',
    PRIORITIES.includes(b.priority) ? b.priority : 'Medium',
    Number(b.progress) || 0, b.estimated_hours ?? null, b.category || '', cycle, b.impact || '');
  logActivity({ task_id: info.lastInsertRowid, user_id: req.user.id, action: 'task.created', detail: b.title });
  res.status(201).json(db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(info.lastInsertRowid));
});

r.put('/tasks/:id', authenticate, requireWriter, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!canEdit(req, task)) return res.status(403).json({ error: 'You can only update tasks assigned to you' });

  // Members report on their work; only the lead can re-scope or re-assign it.
  const MEMBER_FIELDS = ['status', 'progress', 'result', 'result_metric', 'blocker', 'actual_hours', 'impact'];
  const patch = isLead(req)
    ? req.body
    : Object.fromEntries(Object.entries(req.body).filter(([k]) => MEMBER_FIELDS.includes(k)));

  const f = { ...task, ...patch };
  if (f.start_date && f.end_date && f.end_date < f.start_date) {
    return res.status(400).json({ error: 'End date cannot be before the start date' });
  }
  if (!STATUSES.includes(f.status)) return res.status(400).json({ error: 'Unknown status' });
  if (!PRIORITIES.includes(f.priority)) return res.status(400).json({ error: 'Unknown priority' });

  let progress = Math.max(0, Math.min(100, Number(f.progress) || 0));
  let completed_on = f.completed_on;
  if (f.status === 'Completed') {
    progress = 100;
    completed_on = completed_on || new Date().toISOString().slice(0, 10);
  }
  if (task.status === 'Completed' && f.status !== 'Completed') completed_on = null;

  db.prepare(`
    UPDATE tasks SET title=?, description=?, team_id=?, assignee_id=?, target_id=?,
      start_date=?, end_date=?, completed_on=?, status=?, priority=?, progress=?,
      estimated_hours=?, actual_hours=?, category=?, result=?, result_metric=?,
      impact=?, blocker=?, cycle=?, updated_at=datetime('now')
    WHERE id=?`
  ).run(f.title, f.description || '', f.team_id || null, f.assignee_id || null, f.target_id || null,
    f.start_date || null, f.end_date || null, completed_on || null, f.status, f.priority, progress,
    f.estimated_hours ?? null, f.actual_hours ?? null, f.category || '', f.result || '',
    f.result_metric || '', f.impact || '', f.blocker || '', f.cycle, task.id);

  if (task.status !== f.status) {
    logActivity({
      task_id: task.id, user_id: req.user.id, action: 'task.status',
      detail: `${task.status} -> ${f.status}`,
    });
  }
  if ((task.result || '') !== (f.result || '') && f.result) {
    logActivity({ task_id: task.id, user_id: req.user.id, action: 'task.result', detail: 'Result recorded' });
  }
  res.json(db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(task.id));
});

r.delete('/tasks/:id', authenticate, requireWriter, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!isLead(req)) return res.status(403).json({ error: 'Only the marketing lead can delete tasks' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  res.json({ ok: true });
});

/* ---------------- comments ---------------- */

r.post('/tasks/:id/comments', authenticate, requireWriter, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Comment cannot be empty' });
  const info = db.prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?,?,?)')
    .run(task.id, req.user.id, body);
  res.status(201).json(db.prepare(
    `SELECT c.*, u.name AS author_name FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`
  ).get(info.lastInsertRowid));
});

r.delete('/comments/:id', authenticate, requireWriter, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  if (!isLead(req) && c.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own comments' });
  }
  db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

export { STATUSES, PRIORITIES };
export default r;
