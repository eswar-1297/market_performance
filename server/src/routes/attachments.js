import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import db, { logActivity, UPLOAD_DIR } from '../db.js';
import { authenticate, requireWriter, isLead } from '../auth.js';

const r = Router();

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB per file

// Evidence a marketing team actually attaches: screenshots, exports, decks, docs.
const ALLOWED = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx',
  '.txt', '.md', '.json', '.zip',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE, files: 10 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED.has(ext)) return cb(new Error(`File type "${ext || 'unknown'}" is not allowed`));
    cb(null, true);
  },
});

/** A member may attach to their own task; the lead may attach anywhere. */
function assertAttachable(req, { task_id, target_id }) {
  if (isLead(req)) return null;
  if (task_id) {
    const t = db.prepare('SELECT assignee_id FROM tasks WHERE id = ?').get(task_id);
    if (!t) return 'Task not found';
    if (t.assignee_id !== req.user.id) return 'You can only attach files to your own tasks';
    return null;
  }
  if (target_id) {
    const g = db.prepare('SELECT owner_id FROM targets WHERE id = ?').get(target_id);
    if (!g) return 'Target not found';
    if (g.owner_id !== req.user.id) return 'You can only attach files to targets you own';
    return null;
  }
  return 'Attachments must belong to a task or a target';
}

r.post('/attachments', authenticate, requireWriter, (req, res) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const task_id = req.body.task_id ? Number(req.body.task_id) : null;
    const target_id = req.body.target_id ? Number(req.body.target_id) : null;
    const problem = assertAttachable(req, { task_id, target_id });
    if (problem) {
      for (const f of req.files || []) fs.rmSync(f.path, { force: true });
      return res.status(403).json({ error: problem });
    }
    if (!req.files?.length) return res.status(400).json({ error: 'No files were uploaded' });

    const insert = db.prepare(`
      INSERT INTO attachments (task_id, target_id, kind, label, original_name, stored_name,
                               mime_type, size_bytes, uploaded_by)
      VALUES (?,?,'file',?,?,?,?,?,?)`);
    const ids = [];
    for (const f of req.files) {
      const info = insert.run(task_id, target_id, req.body.label || '', f.originalname,
        f.filename, f.mimetype, f.size, req.user.id);
      ids.push(info.lastInsertRowid);
    }
    logActivity({
      task_id, target_id, user_id: req.user.id, action: 'attachment.added',
      detail: req.files.map((f) => f.originalname).join(', '),
    });
    const rows = db.prepare(
      `SELECT a.*, u.name AS uploaded_by_name FROM attachments a
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    res.status(201).json(rows);
  });
});

/** Attach a link (Search Console report, Looker Studio, Figma, Drive doc...). */
r.post('/attachments/link', authenticate, requireWriter, (req, res) => {
  const task_id = req.body.task_id ? Number(req.body.task_id) : null;
  const target_id = req.body.target_id ? Number(req.body.target_id) : null;
  const problem = assertAttachable(req, { task_id, target_id });
  if (problem) return res.status(403).json({ error: problem });

  const url = String(req.body.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Enter a valid http(s) link' });

  const info = db.prepare(`
    INSERT INTO attachments (task_id, target_id, kind, label, url, uploaded_by)
    VALUES (?,?,'link',?,?,?)`
  ).run(task_id, target_id, req.body.label || url, url, req.user.id);
  logActivity({ task_id, target_id, user_id: req.user.id, action: 'attachment.linked', detail: url });
  res.status(201).json(db.prepare(
    `SELECT a.*, u.name AS uploaded_by_name FROM attachments a
     LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.id = ?`).get(info.lastInsertRowid));
});

r.get('/attachments/:id/download', authenticate, (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Attachment not found' });
  if (a.kind === 'link') return res.redirect(a.url);

  // stored_name is generated server-side, but resolve and re-check anyway
  const file = path.join(UPLOAD_DIR, path.basename(a.stored_name));
  if (!file.startsWith(UPLOAD_DIR) || !fs.existsSync(file)) {
    return res.status(404).json({ error: 'The stored file is missing from disk' });
  }
  res.download(file, a.original_name);
});

r.delete('/attachments/:id', authenticate, requireWriter, (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Attachment not found' });
  if (!isLead(req) && a.uploaded_by !== req.user.id) {
    return res.status(403).json({ error: 'You can only remove attachments you uploaded' });
  }
  if (a.kind === 'file' && a.stored_name) {
    fs.rmSync(path.join(UPLOAD_DIR, path.basename(a.stored_name)), { force: true });
  }
  db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

export default r;
