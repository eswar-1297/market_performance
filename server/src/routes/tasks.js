import express, { Router } from 'express';
import { q, one, logActivity } from '../db.js';
import { authenticate, requireWriter, isLead } from '../auth.js';

const r = Router();

const MAX_FILE = 10 * 1024 * 1024;
const currentCycle = () => new Date().toISOString().slice(0, 7);
const isCycle = (c) => /^\d{4}-\d{2}$/.test(String(c || ''));
const STATUSES = ['in_progress', 'done'];
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));

/** Bare "cloudfuze.com/blog/x" becomes a link that opens; anything else is refused. */
function cleanUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  } catch { return null; }
}

// DATE comes back as text so a day never slides across a timezone boundary.
const SELECT_TASKS = `
  SELECT t.id, t.user_id, to_char(t.task_date, 'YYYY-MM-DD') AS task_date, t.url, t.description,
         t.status, t.created_at, t.updated_at, u.name AS user_name, u.team_id,
         tm.name AS team_name, tm.colour AS team_colour
  FROM daily_tasks t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN teams tm ON tm.id = u.team_id`;

/** Each task with its attachments listed — names and sizes, never the bytes. */
async function withAttachments(tasks) {
  if (!tasks.length) return [];
  const files = await q(
    `SELECT a.id, a.task_id, a.original_name, a.mime_type, a.size_bytes, a.created_at,
            u.name AS uploaded_by_name
     FROM task_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.task_id = ANY($1) ORDER BY a.id`,
    [tasks.map((t) => t.id)],
  );
  return tasks.map((t) => ({
    ...t,
    attachments: files.filter((f) => f.task_id === t.id).map((f) => ({ ...f, kind: 'file' })),
  }));
}

/** The task, if this person may change it: their own, or anyone's for the lead. */
async function editableTask(req, id) {
  const task = await one('SELECT * FROM daily_tasks WHERE id = $1', [id]);
  if (!task) return { status: 404, error: 'Task not found' };
  if (!isLead(req) && task.user_id !== req.user.id) {
    return { status: 403, error: 'You can only change your own tasks' };
  }
  return { task };
}

/* ------------------------------------------------------------ the log */

/** A month of tasks — everyone's, or one person's with ?user_id. */
r.get('/tasks', authenticate, async (req, res, next) => {
  try {
    const cycle = isCycle(req.query.cycle) ? req.query.cycle : currentCycle();
    const args = [cycle];
    let where = `to_char(t.task_date, 'YYYY-MM') = $1`;
    if (req.query.user_id) { args.push(Number(req.query.user_id)); where += ' AND t.user_id = $2'; }
    const tasks = await q(`${SELECT_TASKS} WHERE ${where} ORDER BY t.task_date DESC, t.id DESC`, args);
    return res.json(await withAttachments(tasks));
  } catch (e) { return next(e); }
});

r.post('/tasks', authenticate, requireWriter, async (req, res, next) => {
  try {
    const userId = req.body.user_id ? Number(req.body.user_id) : req.user.id;
    if (userId !== req.user.id && !isLead(req)) {
      return res.status(403).json({ error: 'You can only add tasks for yourself' });
    }
    const person = await one('SELECT id, name FROM users WHERE id = $1 AND active', [userId]);
    if (!person) return res.status(404).json({ error: 'Member not found' });

    const { task_date } = req.body;
    if (!isDate(task_date)) return res.status(400).json({ error: 'Pick the day this task was done' });
    const url = cleanUrl(req.body.url);
    if (url === null) return res.status(400).json({ error: 'That URL does not look like a web link' });
    const description = String(req.body.description ?? '').trim();
    if (!url && !description) return res.status(400).json({ error: 'Add a URL or a description' });
    const status = req.body.status ?? 'in_progress';
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Status must be in progress or done' });

    const created = await one(
      `INSERT INTO daily_tasks (user_id, task_date, url, description, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [userId, task_date, url, description, status, req.user.id],
    );
    await logActivity({ user_id: req.user.id, action: 'task.created', detail: `${person.name} · ${task_date}` });
    const [task] = await withAttachments(await q(`${SELECT_TASKS} WHERE t.id = $1`, [created.id]));
    return res.status(201).json(task);
  } catch (e) { return next(e); }
});

r.put('/tasks/:id', authenticate, requireWriter, async (req, res, next) => {
  try {
    const found = await editableTask(req, Number(req.params.id));
    if (found.error) return res.status(found.status).json({ error: found.error });
    const t = found.task;

    const taskDate = req.body.task_date ?? null;
    if (taskDate != null && !isDate(taskDate)) {
      return res.status(400).json({ error: 'Pick the day this task was done' });
    }
    const url = req.body.url != null ? cleanUrl(req.body.url) : t.url;
    if (url === null) return res.status(400).json({ error: 'That URL does not look like a web link' });
    const description = req.body.description != null ? String(req.body.description).trim() : t.description;
    if (!url && !description) return res.status(400).json({ error: 'Add a URL or a description' });
    const status = req.body.status ?? t.status;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Status must be in progress or done' });

    // Without a new date, the stored one is kept as-is rather than round-tripped.
    await q(
      `UPDATE daily_tasks SET task_date = COALESCE($1::date, task_date), url = $2, description = $3,
              status = $4, updated_at = now() WHERE id = $5`,
      [taskDate, url, description, status, t.id],
    );
    const [task] = await withAttachments(await q(`${SELECT_TASKS} WHERE t.id = $1`, [t.id]));
    return res.json(task);
  } catch (e) { return next(e); }
});

r.delete('/tasks/:id', authenticate, requireWriter, async (req, res, next) => {
  try {
    const found = await editableTask(req, Number(req.params.id));
    if (found.error) return res.status(found.status).json({ error: found.error });
    await q('DELETE FROM daily_tasks WHERE id = $1', [found.task.id]);
    await logActivity({ user_id: req.user.id, action: 'task.deleted', detail: `task #${found.task.id}` });
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

/* ------------------------------------------------------- attachments */

// The file is the request body itself; its name rides in a header.
r.post('/tasks/:id/attachments', authenticate, requireWriter,
  express.raw({ type: () => true, limit: MAX_FILE }),
  async (req, res, next) => {
    try {
      const found = await editableTask(req, Number(req.params.id));
      if (found.error) return res.status(found.status).json({ error: found.error });
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ error: 'The file is empty' });
      }
      let name = 'file';
      try { name = decodeURIComponent(String(req.headers['x-filename'] || 'file')); } catch { /* keep default */ }
      name = name.replace(/[\\/\r\n"]/g, '_').slice(0, 200) || 'file';
      const mime = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120);

      const saved = await one(
        `INSERT INTO task_attachments (task_id, original_name, mime_type, size_bytes, data, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, task_id, original_name, mime_type, size_bytes, created_at`,
        [found.task.id, name, mime, req.body.length, req.body, req.user.id],
      );
      return res.status(201).json({ ...saved, kind: 'file', uploaded_by_name: req.user.name });
    } catch (e) { return next(e); }
  });

r.get('/attachments/:id/download', authenticate, async (req, res, next) => {
  try {
    const a = await one('SELECT original_name, mime_type, data FROM task_attachments WHERE id = $1',
      [Number(req.params.id)]);
    if (!a) return res.status(404).json({ error: 'Attachment not found' });
    res.setHeader('content-type', a.mime_type);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(a.original_name)}`);
    return res.send(a.data);
  } catch (e) { return next(e); }
});

r.delete('/attachments/:id', authenticate, requireWriter, async (req, res, next) => {
  try {
    const a = await one('SELECT id, task_id FROM task_attachments WHERE id = $1', [Number(req.params.id)]);
    if (!a) return res.status(404).json({ error: 'Attachment not found' });
    const found = await editableTask(req, a.task_id);
    if (found.error) return res.status(found.status).json({ error: found.error });
    await q('DELETE FROM task_attachments WHERE id = $1', [a.id]);
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

/* ------------------------------------------------------------- export */

/** The month's work as a spreadsheet, one line per task. */
r.get('/export/tasks.csv', authenticate, async (req, res, next) => {
  try {
    const cycle = isCycle(req.query.cycle) ? req.query.cycle : currentCycle();
    const tasks = await withAttachments(await q(
      `${SELECT_TASKS} WHERE to_char(t.task_date, 'YYYY-MM') = $1
       ORDER BY tm.sort_order NULLS LAST, u.name, t.task_date, t.id`, [cycle],
    ));
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Team', 'Name', 'Date', 'Status', 'URL', 'Description', 'Attachments'].map(esc).join(',')];
    for (const t of tasks) {
      lines.push([t.team_name, t.user_name, t.task_date,
        t.status === 'done' ? 'Done' : 'In progress', t.url, t.description,
        t.attachments.map((a) => a.original_name).join('; ')].map(esc).join(','));
    }
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="daily-tasks-${cycle}.csv"`);
    return res.send(lines.join('\n'));
  } catch (e) { return next(e); }
});

export default r;
