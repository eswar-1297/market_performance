import { Router } from 'express';
import db from '../db.js';
import { authenticate } from '../auth.js';
import { metricProgress } from './targets.js';

const r = Router();

const currentCycle = () => new Date().toISOString().slice(0, 7);

/** Every month whose sheet has something filled in, newest first, plus this month. */
r.get('/cycles', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT cycle FROM scorecard_cells WHERE target <> '' OR achieved <> ''
    UNION SELECT ? AS cycle
    ORDER BY cycle DESC`).all(currentCycle());
  res.json(rows.map((x) => x.cycle));
});

/** Headline numbers + per-team and per-member breakdowns for one month. */
r.get('/dashboard', authenticate, (req, res) => {
  const cycle = req.query.cycle || currentCycle();

  const totals = db.prepare(`
    SELECT COUNT(*)                                                    AS total,
           SUM(status = 'Completed')                                   AS completed,
           SUM(status = 'In Progress')                                 AS in_progress,
           SUM(status = 'Not Started')                                 AS not_started,
           SUM(status = 'Blocked')                                     AS blocked,
           SUM(status = 'In Review')                                   AS in_review,
           SUM(status NOT IN ('Completed','Cancelled')
               AND end_date IS NOT NULL AND date(end_date) < date('now')) AS overdue,
           SUM(status = 'Completed' AND completed_on IS NOT NULL
               AND end_date IS NOT NULL AND date(completed_on) <= date(end_date)) AS on_time,
           COALESCE(SUM(estimated_hours), 0)                           AS est_hours,
           COALESCE(SUM(actual_hours), 0)                              AS act_hours
    FROM tasks WHERE cycle = ?`).get(cycle);

  const byTeam = db.prepare(`
    SELECT tm.id, tm.name, tm.colour,
           COUNT(t.id)                  AS total,
           SUM(t.status = 'Completed')  AS completed,
           SUM(t.status = 'In Progress')AS in_progress,
           SUM(t.status = 'Blocked')    AS blocked,
           SUM(t.status NOT IN ('Completed','Cancelled')
               AND t.end_date IS NOT NULL AND date(t.end_date) < date('now')) AS overdue,
           COALESCE(ROUND(AVG(t.progress)), 0) AS avg_progress
    FROM teams tm LEFT JOIN tasks t ON t.team_id = tm.id AND t.cycle = ?
    GROUP BY tm.id ORDER BY tm.sort_order`).all(cycle);

  const byMember = db.prepare(`
    SELECT u.id, u.name, u.designation, tm.name AS team_name, tm.colour AS team_colour,
           COUNT(t.id)                  AS total,
           SUM(t.status = 'Completed')  AS completed,
           SUM(t.status = 'Blocked')    AS blocked,
           SUM(t.status NOT IN ('Completed','Cancelled')
               AND t.end_date IS NOT NULL AND date(t.end_date) < date('now')) AS overdue,
           COALESCE(ROUND(AVG(t.progress)), 0) AS avg_progress
    FROM users u
    LEFT JOIN teams tm ON tm.id = u.team_id
    LEFT JOIN tasks t  ON t.assignee_id = u.id AND t.cycle = ?
    WHERE u.active = 1 AND u.role <> 'stakeholder'
    GROUP BY u.id ORDER BY tm.sort_order, u.name`).all(cycle);

  const targets = db.prepare(`
    SELECT g.*, tm.name AS team_name, tm.colour AS team_colour, u.name AS owner_name
    FROM targets g
    LEFT JOIN teams tm ON tm.id = g.team_id
    LEFT JOIN users u  ON u.id  = g.owner_id
    WHERE g.cycle = ? ORDER BY tm.sort_order, g.kind = 'narrative', g.id`).all(cycle);

  const targetSummary = targets.reduce((acc, t) => {
    acc.total += 1;
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, { total: 0 });

  const trend = db.prepare(`
    SELECT cycle,
           COUNT(*)                   AS total,
           SUM(status = 'Completed')  AS completed
    FROM tasks GROUP BY cycle ORDER BY cycle`).all();

  const upcoming = db.prepare(`
    SELECT t.id, t.title, t.end_date, t.status, t.priority, u.name AS assignee_name,
           tm.name AS team_name, tm.colour AS team_colour
    FROM tasks t
    LEFT JOIN users u  ON u.id  = t.assignee_id
    LEFT JOIN teams tm ON tm.id = t.team_id
    WHERE t.status NOT IN ('Completed','Cancelled') AND t.end_date IS NOT NULL
      AND date(t.end_date) BETWEEN date('now') AND date('now', '+7 day')
    ORDER BY date(t.end_date) LIMIT 20`).all();

  const blockers = db.prepare(`
    SELECT t.id, t.title, t.blocker, u.name AS assignee_name, tm.name AS team_name
    FROM tasks t
    LEFT JOIN users u  ON u.id  = t.assignee_id
    LEFT JOIN teams tm ON tm.id = t.team_id
    WHERE t.cycle = ? AND (t.status = 'Blocked' OR (t.blocker IS NOT NULL AND t.blocker <> ''))
    ORDER BY tm.sort_order`).all(cycle);

  const completedTotal = totals.completed || 0;
  res.json({
    cycle,
    totals: {
      ...totals,
      completion_rate: totals.total ? Math.round((completedTotal / totals.total) * 100) : 0,
      on_time_rate: completedTotal ? Math.round(((totals.on_time || 0) / completedTotal) * 100) : 0,
    },
    by_team: byTeam,
    by_member: byMember,
    targets: targets.map((t) => ({ ...t, progress_pct: metricProgress(t) })),
    target_summary: targetSummary,
    trend,
    upcoming,
    blockers,
  });
});

/** The board-ready view: wins, results delivered, target scorecard, misses. */
r.get('/mbr', authenticate, (req, res) => {
  const cycle = req.query.cycle || currentCycle();

  const wins = db.prepare(`
    SELECT t.id, t.title, t.result, t.result_metric, t.impact, t.completed_on,
           u.name AS assignee_name, tm.name AS team_name, tm.colour AS team_colour,
           (SELECT COUNT(*) FROM attachments a WHERE a.task_id = t.id) AS attachment_count
    FROM tasks t
    LEFT JOIN users u  ON u.id  = t.assignee_id
    LEFT JOIN teams tm ON tm.id = t.team_id
    WHERE t.cycle = ? AND t.status = 'Completed' AND t.result <> ''
    ORDER BY CASE t.impact WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
             tm.sort_order, t.completed_on DESC`).all(cycle);

  const misses = db.prepare(`
    SELECT t.id, t.title, t.status, t.progress, t.end_date, t.blocker,
           u.name AS assignee_name, tm.name AS team_name
    FROM tasks t
    LEFT JOIN users u  ON u.id  = t.assignee_id
    LEFT JOIN teams tm ON tm.id = t.team_id
    WHERE t.cycle = ? AND t.status NOT IN ('Completed','Cancelled')
    ORDER BY tm.sort_order, t.progress DESC`).all(cycle);

  const targets = db.prepare(`
    SELECT g.*, tm.name AS team_name, tm.colour AS team_colour, u.name AS owner_name
    FROM targets g
    LEFT JOIN teams tm ON tm.id = g.team_id
    LEFT JOIN users u  ON u.id  = g.owner_id
    WHERE g.cycle = ? ORDER BY tm.sort_order, g.kind = 'narrative', g.id`).all(cycle);

  res.json({
    cycle,
    wins,
    misses,
    targets: targets.map((t) => ({ ...t, progress_pct: metricProgress(t) })),
  });
});

/* ---------------- CSV export ---------------- */

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows, cols) =>
  [cols.join(','), ...rows.map((row) => cols.map((c) => csvCell(row[c])).join(','))].join('\r\n');

r.get('/export/tasks.csv', authenticate, (req, res) => {
  const cycle = req.query.cycle || currentCycle();
  const rows = db.prepare(`
    SELECT tm.name AS team, u.name AS assignee, t.title, t.description, t.category,
           t.start_date, t.end_date, t.completed_on, t.status, t.priority, t.progress,
           t.estimated_hours, t.actual_hours, t.result, t.result_metric, t.impact, t.blocker,
           g.title AS linked_target,
           (SELECT COUNT(*) FROM attachments a WHERE a.task_id = t.id) AS attachments
    FROM tasks t
    LEFT JOIN users u   ON u.id  = t.assignee_id
    LEFT JOIN teams tm  ON tm.id = t.team_id
    LEFT JOIN targets g ON g.id  = t.target_id
    WHERE t.cycle = ? ORDER BY tm.sort_order, u.name, t.end_date`).all(cycle);
  const cols = ['team', 'assignee', 'title', 'description', 'category', 'start_date', 'end_date',
    'completed_on', 'status', 'priority', 'progress', 'estimated_hours', 'actual_hours',
    'result', 'result_metric', 'impact', 'blocker', 'linked_target', 'attachments'];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tasks-${cycle}.csv"`);
  res.send('﻿' + toCsv(rows, cols));
});

r.get('/export/targets.csv', authenticate, (req, res) => {
  const cycle = req.query.cycle || currentCycle();
  const rows = db.prepare(`
    SELECT tm.name AS team, u.name AS owner, g.title, g.detail, g.kind, g.metric_name, g.unit,
           g.baseline, g.target_value, g.current_value, g.direction, g.status, g.source
    FROM targets g
    LEFT JOIN teams tm ON tm.id = g.team_id
    LEFT JOIN users u  ON u.id  = g.owner_id
    WHERE g.cycle = ? ORDER BY tm.sort_order, g.id`).all(cycle);
  const out = rows.map((t) => ({ ...t, progress_pct: metricProgress(t) ?? '' }));
  const cols = ['team', 'owner', 'title', 'detail', 'kind', 'metric_name', 'unit', 'baseline',
    'target_value', 'current_value', 'direction', 'progress_pct', 'status', 'source'];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="targets-${cycle}.csv"`);
  res.send('﻿' + toCsv(out, cols));
});

export default r;
