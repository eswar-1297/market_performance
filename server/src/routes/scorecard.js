import { Router } from 'express';
import db, { logActivity, parseField } from '../db.js';
import { authenticate, requireLead, requireWriter, isLead } from '../auth.js';

const r = Router();

const currentCycle = () => new Date().toISOString().slice(0, 7);
const DIRECTIONS = ['up', 'down'];

/** "$1,240" -> 1240, "20%" -> 20, "7,068 visits" -> 7068, "ENT" -> null. */
function toNumber(v) {
  const s = String(v ?? '').trim().replace(/,/g, '');
  if (!s) return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * How one box did. Numbers are compared in the column's direction (CPL and 404s
 * count down), identical text counts as met, and anything that cannot be judged
 * is flagged rather than guessed at — nobody is marked as missing a target on a
 * comparison the app is not sure about.
 */
export function scoreCell(target, achieved, direction = 'up') {
  const t = String(target ?? '').trim();
  const a = String(achieved ?? '').trim();
  if (!t && !a) return { verdict: 'blank', pct: null };
  if (t && !a) return { verdict: 'not_reported', pct: null };
  if (!t && a) return { verdict: 'no_target', pct: null };

  const tn = toNumber(t);
  const an = toNumber(a);
  if (tn !== null && an !== null) {
    const down = direction === 'down';
    const met = down ? an <= tn : an >= tn;
    let pct;
    if (down) pct = an <= 0 ? 100 : Math.round((tn / an) * 100);
    else pct = tn <= 0 ? (an >= tn ? 100 : 0) : Math.round((an / tn) * 100);
    return { verdict: met ? 'met' : 'missed', pct: Math.max(0, Math.min(999, pct)) };
  }
  if (norm(t) === norm(a)) return { verdict: 'met', pct: 100 };
  return { verdict: 'unclear', pct: null };
}

/* --------------------------------------------------------------- loading */

const teamsQ = () => db.prepare('SELECT id, name, colour, description FROM teams ORDER BY sort_order, name').all();
const fieldsQ = () => db.prepare('SELECT * FROM scorecard_fields ORDER BY sort_order, id').all();
const peopleQ = () => db.prepare(`
  SELECT id, name, designation, team_id FROM users
  WHERE active = 1 AND role <> 'stakeholder' AND team_id IS NOT NULL
  ORDER BY id`).all();

/**
 * Every line of the sheet: a person's unlabelled row, plus one row per label
 * they have added. People with no rows in the table yet get their default row
 * back as `id: null` — it is written for real the first time something is typed.
 */
function rowsFor(people) {
  const saved = db.prepare('SELECT * FROM scorecard_rows ORDER BY sort_order, id').all();
  const out = [];
  for (const p of people) {
    const mine = saved.filter((x) => x.user_id === p.id);
    if (mine.length === 0) {
      // Nothing written for this person yet — show the one row they start with.
      out.push({ id: null, user_id: p.id, team_id: p.team_id, label: '', sort_order: 0 });
    }
    out.push(...mine.map((x) => ({
      id: x.id, user_id: x.user_id, label: x.label, sort_order: x.sort_order,
      team_id: x.team_id || p.team_id,          // a row can sit on another team's sheet
    })));
  }
  return out.sort((a, b) => a.user_id - b.user_id || a.sort_order - b.sort_order || a.id - b.id);
}

/** The person's first row, written for real the first time it is needed. */
function firstRowId(user_id) {
  const found = db.prepare(
    'SELECT id FROM scorecard_rows WHERE user_id = ? ORDER BY sort_order, id LIMIT 1'
  ).get(user_id);
  if (found) return found.id;
  return db.prepare('INSERT INTO scorecard_rows (user_id, label, sort_order) VALUES (?,?,0)')
    .run(user_id, '').lastInsertRowid;
}

/**
 * The whole month as a grid: a table per team, a line per person (or per
 * labelled row of that person), and a column per thing that team is measured
 * on. Every cell carries a target and what was actually achieved, both free
 * text so the team can write "20%", "ENT" or "US".
 */
r.get('/scorecard', authenticate, (req, res) => {
  const cycle = req.query.cycle || currentCycle();

  const teams = teamsQ();
  const fields = fieldsQ();
  const people = peopleQ();
  const rows = rowsFor(people);
  const cells = db.prepare(
    'SELECT row_id, field_id, target, achieved FROM scorecard_cells WHERE cycle = ?'
  ).all(cycle);

  const cellAt = new Map(cells.map((c) => [`${c.row_id}:${c.field_id}`, c]));
  const personAt = new Map(people.map((p) => [p.id, p]));
  const canEditRow = (userId) => !!req.user && (isLead(req) || req.user.id === userId);

  res.json({
    cycle,
    teams: teams.map((t) => {
      const teamFields = fields.filter((f) => f.team_id === t.id);
      const teamRows = rows.filter((row) => row.team_id === t.id).map((row) => {
        const p = personAt.get(row.user_id);
        const values = {};
        for (const f of teamFields) {
          const c = cellAt.get(`${row.id}:${f.id}`);
          values[f.id] = { target: c?.target || '', achieved: c?.achieved || '' };
        }
        return {
          row_id: row.id, label: row.label, user_id: p.id, name: p.name,
          designation: p.designation, can_edit: canEditRow(p.id), values,
        };
      });
      const total = teamRows.length * teamFields.length;
      const filled = teamRows.reduce((n, row) => n + teamFields.filter((f) =>
        row.values[f.id].target !== '' || row.values[f.id].achieved !== '').length, 0);
      return {
        ...t,
        fields: teamFields,
        rows: teamRows,
        people: new Set(teamRows.map((x) => x.user_id)).size,
        total_cells: total,
        filled_cells: filled,
      };
    }),
  });
});

/**
 * The month judged rather than repeated: who hit their targets, who did not,
 * which teams are behind and by how much. Built from the same cells as the
 * sheet, so there is nothing extra to write up at month end.
 */
r.get('/review', authenticate, (req, res) => {
  const cycle = req.query.cycle || currentCycle();

  const teams = teamsQ();
  const fields = fieldsQ();
  const people = peopleQ();
  const rows = rowsFor(people);
  const cells = db.prepare(
    'SELECT row_id, field_id, target, achieved FROM scorecard_cells WHERE cycle = ?'
  ).all(cycle);
  const cellAt = new Map(cells.map((c) => [`${c.row_id}:${c.field_id}`, c]));
  const personAt = new Map(people.map((p) => [p.id, p]));

  const blank = () => ({ met: 0, missed: 0, not_reported: 0, unclear: 0, no_target: 0, blank: 0 });
  const pctOf = (t) => (t.met + t.missed ? Math.round((t.met / (t.met + t.missed)) * 100) : null);
  const overall = blank();

  const teamRows = teams.map((team) => {
    const teamFields = fields.filter((f) => f.team_id === team.id);
    const tally = blank();

    // Somebody who works across two teams is scored once per team, against
    // that team's own columns.
    const byPerson = new Map();
    for (const row of rows.filter((x) => x.team_id === team.id)) {
      const p = personAt.get(row.user_id);
      if (!p) continue;
      if (!byPerson.has(p.id)) {
        byPerson.set(p.id, {
          user_id: p.id, name: p.name, designation: p.designation, rows: 0, misses: [], ...blank(),
        });
      }
      const mine = byPerson.get(p.id);
      mine.rows += 1;
      for (const f of teamFields) {
        const c = cellAt.get(`${row.id}:${f.id}`) || { target: '', achieved: '' };
        const { verdict, pct } = scoreCell(c.target, c.achieved, f.direction);
        mine[verdict] += 1; tally[verdict] += 1; overall[verdict] += 1;
        if (verdict === 'missed' || verdict === 'not_reported') {
          mine.misses.push({
            field: f.name, group: f.group_name, row_label: row.label, direction: f.direction,
            target: c.target, achieved: c.achieved, pct, verdict,
          });
        }
      }
    }
    const members = [...byPerson.values()].map((m) => ({
      ...m, scored: m.met + m.missed, pct: pctOf(m),
    }));

    return {
      ...team,
      fields: teamFields.length,
      people: members.length,
      ...tally,
      scored: tally.met + tally.missed,
      pct: pctOf(tally),
      members,
    };
  });

  const allMembers = teamRows.flatMap((t) => t.members.map((m) => ({ ...m, team: t.name, colour: t.colour })));

  res.json({
    cycle,
    overall: {
      ...overall,
      teams: teamRows.filter((t) => t.people > 0).length,
      people: new Set(allMembers.map((m) => m.user_id)).size,
      scored: overall.met + overall.missed,
      pct: pctOf(overall),
      people_missed: new Set(allMembers.filter((m) => m.misses.length > 0).map((m) => m.user_id)).size,
      people_clean: new Set(allMembers.filter((m) => m.misses.length === 0 && m.met > 0).map((m) => m.user_id)).size,
      people_silent: allMembers.filter((m) => m.met === 0 && m.missed === 0 && m.not_reported === 0).length,
      teams_behind: teamRows.filter((t) => t.missed > 0 || t.not_reported > 0).length,
    },
    teams: teamRows,
    members: allMembers,
  });
});

/* ------------------------------------------------------------------ cells */

/**
 * Save one cell, addressed by the row it sits on. A row that exists is given by
 * `row_id`; a person whose first row has never been written is given by
 * `user_id` alone, and that row is created here.
 */
r.put('/scorecard/cell', authenticate, requireWriter, (req, res) => {
  const { cycle, field_id } = req.body;
  if (!cycle || !field_id || (!req.body.row_id && !req.body.user_id)) {
    return res.status(400).json({ error: 'cycle, field_id and a row are required' });
  }

  const row = req.body.row_id
    ? db.prepare('SELECT * FROM scorecard_rows WHERE id = ?').get(req.body.row_id)
    : null;
  if (req.body.row_id && !row) return res.status(404).json({ error: 'That row no longer exists' });

  const userId = row ? row.user_id : Number(req.body.user_id);
  if (!isLead(req) && userId !== req.user.id) {
    return res.status(403).json({ error: 'You can only fill in your own row' });
  }
  const field = db.prepare('SELECT * FROM scorecard_fields WHERE id = ?').get(field_id);
  if (!field) return res.status(404).json({ error: 'That column no longer exists' });
  const person = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(userId);
  if (!person) return res.status(404).json({ error: 'That person no longer exists' });
  const rowTeam = (row && row.team_id) || person.team_id;
  if (rowTeam !== field.team_id) {
    return res.status(400).json({ error: `${field.name} is not a column on that team's sheet` });
  }

  const target = String(req.body.target ?? '').slice(0, 200);
  const achieved = String(req.body.achieved ?? '').slice(0, 200);
  const rowId = row ? row.id : firstRowId(person.id);

  db.prepare(`
    INSERT INTO scorecard_cells (cycle, row_id, field_id, target, achieved, updated_by)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(cycle, row_id, field_id) DO UPDATE SET
      target = excluded.target, achieved = excluded.achieved,
      updated_by = excluded.updated_by, updated_at = datetime('now')`
  ).run(cycle, rowId, field_id, target, achieved, req.user.id);

  res.json(db.prepare(
    'SELECT * FROM scorecard_cells WHERE cycle = ? AND row_id = ? AND field_id = ?'
  ).get(cycle, rowId, field_id));
});

/* ------------------------------------------------------------------- rows */

/**
 * Another blank line for one person. It arrives with no label — whoever owns
 * the row types one in ("US", "UK", "ENT") along with their numbers.
 */
r.post('/scorecard/rows', authenticate, requireWriter, (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'A person is required' });
  if (!isLead(req) && Number(user_id) !== req.user.id) {
    return res.status(403).json({ error: 'You can only add rows for yourself' });
  }
  const person = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(user_id);
  if (!person) return res.status(404).json({ error: 'That person no longer exists' });

  // Make sure their first row exists, so the new one lands underneath it.
  firstRowId(person.id);
  const label = String(req.body.label ?? '').trim().slice(0, 60);
  // A row can sit on another team's sheet — that is how one person appears
  // under both PPC and SEO/GEO without a second account.
  let teamId = req.body.team_id ? Number(req.body.team_id) : person.team_id;
  if (teamId && !db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) {
    return res.status(404).json({ error: 'That team no longer exists' });
  }
  const next = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM scorecard_rows WHERE user_id = ?')
    .get(person.id).n;
  const id = db.prepare('INSERT INTO scorecard_rows (user_id, team_id, label, sort_order) VALUES (?,?,?,?)')
    .run(person.id, teamId, label, next).lastInsertRowid;
  logActivity({ user_id: req.user.id, action: 'scorecard.row_added', detail: person.name });
  res.status(201).json(db.prepare('SELECT * FROM scorecard_rows WHERE id = ?').get(id));
});

/** Label a person's first row, writing that row if it has never been touched. */
r.put('/scorecard/rows', authenticate, requireWriter, (req, res) => {
  const user_id = Number(req.body.user_id);
  if (!user_id) return res.status(400).json({ error: 'A person is required' });
  if (!isLead(req) && user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only change your own rows' });
  }
  const person = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(user_id);
  if (!person) return res.status(404).json({ error: 'That person no longer exists' });
  const id = firstRowId(person.id);
  db.prepare('UPDATE scorecard_rows SET label = ? WHERE id = ?')
    .run(String(req.body.label ?? '').trim().slice(0, 60), id);
  res.json(db.prepare('SELECT * FROM scorecard_rows WHERE id = ?').get(id));
});

/** Label a row, or change the label. Blank clears it. */
r.put('/scorecard/rows/:id', authenticate, requireWriter, (req, res) => {
  const row = db.prepare('SELECT * FROM scorecard_rows WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Row not found' });
  if (!isLead(req) && row.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only change your own rows' });
  }
  const label = String(req.body.label ?? row.label).trim().slice(0, 60);
  db.prepare('UPDATE scorecard_rows SET label = ? WHERE id = ?').run(label, row.id);
  res.json(db.prepare('SELECT * FROM scorecard_rows WHERE id = ?').get(row.id));
});

/** Removing a row removes what was filled in on it, in every month. */
r.delete('/scorecard/rows/:id', authenticate, requireWriter, (req, res) => {
  const row = db.prepare('SELECT * FROM scorecard_rows WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Row not found' });
  if (!isLead(req) && row.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only remove your own rows' });
  }
  const mine = db.prepare('SELECT COUNT(*) AS n FROM scorecard_rows WHERE user_id = ?').get(row.user_id).n;
  if (mine <= 1) return res.status(400).json({ error: 'Everyone needs at least one row' });
  const used = db.prepare(
    `SELECT COUNT(*) AS n FROM scorecard_cells WHERE row_id = ? AND (target <> '' OR achieved <> '')`
  ).get(row.id).n;
  db.prepare('DELETE FROM scorecard_rows WHERE id = ?').run(row.id);
  logActivity({
    user_id: req.user.id, action: 'scorecard.row_removed',
    detail: `${row.label}${used ? ` (${used} filled cell(s) discarded)` : ''}`,
  });
  res.json({ ok: true, discarded_cells: used });
});

/* ---------------------------------------------------------------- columns */

r.post('/scorecard/fields', authenticate, requireLead, (req, res) => {
  const { team_id, name } = req.body;
  if (!team_id || !String(name || '').trim()) {
    return res.status(400).json({ error: 'A team and a column name are required' });
  }
  // "Newsletter > open rate" puts the column under a Newsletter heading.
  const parsed = parseField(String(name).trim());
  const clean = parsed.name.slice(0, 60);
  const group = (req.body.group_name != null
    ? String(req.body.group_name).trim()
    : parsed.group_name).slice(0, 60);
  if (!clean) return res.status(400).json({ error: 'A column name is required' });
  if (db.prepare('SELECT 1 FROM scorecard_fields WHERE team_id = ? AND lower(name) = lower(?) AND lower(group_name) = lower(?)')
    .get(team_id, clean, group)) {
    return res.status(409).json({ error: `That team already has a "${clean}" column` });
  }
  // A new sub-column belongs beside the others under its heading, not at the
  // far end of the sheet, so make room for it there.
  let next = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM scorecard_fields WHERE team_id = ?')
    .get(team_id).n;
  if (group) {
    const lastInGroup = db.prepare(
      'SELECT MAX(sort_order) AS n FROM scorecard_fields WHERE team_id = ? AND group_name = ?'
    ).get(team_id, group).n;
    if (lastInGroup != null) {
      db.prepare('UPDATE scorecard_fields SET sort_order = sort_order + 1 WHERE team_id = ? AND sort_order > ?')
        .run(team_id, lastInGroup);
      next = lastInGroup + 1;
    }
  }
  const direction = DIRECTIONS.includes(req.body.direction) ? req.body.direction : parsed.direction;
  const info = db.prepare(
    'INSERT INTO scorecard_fields (team_id, group_name, name, direction, sort_order) VALUES (?,?,?,?,?)'
  ).run(team_id, group, clean, direction, next);
  logActivity({ user_id: req.user.id, action: 'scorecard.column_added', detail: clean });
  res.status(201).json(db.prepare('SELECT * FROM scorecard_fields WHERE id = ?').get(info.lastInsertRowid));
});

/**
 * Add one sub-column under a column. Click the + on "Guest blog" and it becomes
 * a heading with the new column under it; click it again for a third, a fourth,
 * as many as the team needs. A column that already has numbers in it keeps them
 * — it slides under its own heading as "total" — and an empty one simply turns
 * into the heading.
 */
r.post('/scorecard/fields/:id/sub', authenticate, requireLead, (req, res) => {
  const field = db.prepare('SELECT * FROM scorecard_fields WHERE id = ?').get(req.params.id);
  if (!field) return res.status(404).json({ error: 'Column not found' });

  const name = String(req.body.name ?? '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'A name for the sub-column is required' });
  const direction = DIRECTIONS.includes(req.body.direction) ? req.body.direction : 'up';

  // Clicking + on a sub-column adds a sibling under the same heading.
  const group = field.group_name || field.name;
  if (db.prepare('SELECT 1 FROM scorecard_fields WHERE team_id = ? AND group_name = ? AND lower(name) = lower(?)')
    .get(field.team_id, group, name)) {
    return res.status(409).json({ error: `“${group}” already has a “${name}” column` });
  }

  const result = db.transaction(() => {
    let anchorSort = field.sort_order;
    if (!field.group_name) {
      const used = db.prepare(
        `SELECT COUNT(*) AS n FROM scorecard_cells WHERE field_id = ? AND (target <> '' OR achieved <> '')`
      ).get(field.id).n;
      if (used) {
        // Keep the column — and its numbers — as the first thing under the heading.
        db.prepare(`UPDATE scorecard_fields SET group_name = ?, name = 'total' WHERE id = ?`)
          .run(field.name, field.id);
      } else {
        db.prepare('DELETE FROM scorecard_fields WHERE id = ?').run(field.id);
        anchorSort = field.sort_order - 1;
      }
    } else {
      anchorSort = db.prepare(
        'SELECT MAX(sort_order) AS n FROM scorecard_fields WHERE team_id = ? AND group_name = ?'
      ).get(field.team_id, group).n ?? field.sort_order;
    }

    db.prepare('UPDATE scorecard_fields SET sort_order = sort_order + 1 WHERE team_id = ? AND sort_order > ?')
      .run(field.team_id, anchorSort);
    const info = db.prepare(
      'INSERT INTO scorecard_fields (team_id, group_name, name, direction, sort_order) VALUES (?,?,?,?,?)'
    ).run(field.team_id, group, name, direction, anchorSort + 1);
    return db.prepare('SELECT * FROM scorecard_fields WHERE id = ?').get(info.lastInsertRowid);
  })();

  logActivity({ user_id: req.user.id, action: 'scorecard.subcolumn_added', detail: `${group} — ${name}` });
  res.status(201).json(result);
});

r.put('/scorecard/fields/:id', authenticate, requireLead, (req, res) => {
  const field = db.prepare('SELECT * FROM scorecard_fields WHERE id = ?').get(req.params.id);
  if (!field) return res.status(404).json({ error: 'Column not found' });
  const name = String(req.body.name ?? field.name).trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'A column name is required' });
  const sort = req.body.sort_order ?? field.sort_order;
  const direction = DIRECTIONS.includes(req.body.direction) ? req.body.direction : field.direction;
  // Moving a column under a heading keeps its id, so everything filled in on it
  // in every month comes along.
  const group = (req.body.group_name != null
    ? String(req.body.group_name).trim()
    : field.group_name).slice(0, 60);
  db.prepare('UPDATE scorecard_fields SET group_name = ?, name = ?, direction = ?, sort_order = ? WHERE id = ?')
    .run(group, name, direction, sort, field.id);
  res.json(db.prepare('SELECT * FROM scorecard_fields WHERE id = ?').get(field.id));
});

/** Rename a heading — every column under it moves with it. */
r.put('/scorecard/groups', authenticate, requireLead, (req, res) => {
  const { team_id } = req.body;
  const from = String(req.body.from ?? '').trim();
  const to = String(req.body.to ?? '').trim().slice(0, 60);
  if (!team_id || !from) return res.status(400).json({ error: 'A team and a heading are required' });
  if (!to) return res.status(400).json({ error: 'A heading name is required' });
  const n = db.prepare('UPDATE scorecard_fields SET group_name = ? WHERE team_id = ? AND group_name = ?')
    .run(to, team_id, from).changes;
  if (!n) return res.status(404).json({ error: 'Heading not found' });
  logActivity({ user_id: req.user.id, action: 'scorecard.heading_renamed', detail: `${from} -> ${to}` });
  res.json({ ok: true, columns: n });
});

/** Delete a heading and every column under it, with whatever they hold. */
r.delete('/scorecard/groups', authenticate, requireLead, (req, res) => {
  const team_id = req.query.team_id || req.body?.team_id;
  const name = String(req.query.name ?? req.body?.name ?? '').trim();
  if (!team_id || !name) return res.status(400).json({ error: 'A team and a heading are required' });
  const fields = db.prepare('SELECT * FROM scorecard_fields WHERE team_id = ? AND group_name = ?')
    .all(team_id, name);
  if (!fields.length) return res.status(404).json({ error: 'Heading not found' });
  const used = db.prepare(`
    SELECT COUNT(*) AS n FROM scorecard_cells
    WHERE (target <> '' OR achieved <> '')
      AND field_id IN (${fields.map(() => '?').join(',')})`).get(...fields.map((f) => f.id)).n;
  db.prepare(`DELETE FROM scorecard_fields WHERE id IN (${fields.map(() => '?').join(',')})`)
    .run(...fields.map((f) => f.id));
  logActivity({
    user_id: req.user.id, action: 'scorecard.heading_removed',
    detail: `${name} (${fields.length} column(s)${used ? `, ${used} filled box(es)` : ''})`,
  });
  res.json({ ok: true, columns: fields.length, discarded_cells: used });
});

r.delete('/scorecard/fields/:id', authenticate, requireLead, (req, res) => {
  const field = db.prepare('SELECT * FROM scorecard_fields WHERE id = ?').get(req.params.id);
  if (!field) return res.status(404).json({ error: 'Column not found' });
  const used = db.prepare(`
    SELECT COUNT(*) AS n FROM scorecard_cells
    WHERE field_id = ? AND (target <> '' OR achieved <> '')`).get(field.id).n;
  db.prepare('DELETE FROM scorecard_fields WHERE id = ?').run(field.id);
  logActivity({
    user_id: req.user.id, action: 'scorecard.column_removed',
    detail: `${field.name}${used ? ` (${used} filled cell(s) discarded)` : ''}`,
  });
  res.json({ ok: true, discarded_cells: used });
});

/* ----------------------------------------------------------------- export */

/** The grid as a spreadsheet, one block per team — same shape as on screen. */
r.get('/export/scorecard.csv', authenticate, (req, res) => {
  const cycle = req.query.cycle || currentCycle();
  const teams = teamsQ();
  const fields = fieldsQ();
  const people = peopleQ();
  const rows = rowsFor(people);
  const personAt = new Map(people.map((p) => [p.id, p]));
  const cells = db.prepare(
    'SELECT row_id, field_id, target, achieved FROM scorecard_cells WHERE cycle = ?'
  ).all(cycle);
  const cellAt = new Map(cells.map((c) => [`${c.row_id}:${c.field_id}`, c]));

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [];
  for (const t of teams) {
    const tf = fields.filter((f) => f.team_id === t.id);
    if (!tf.length) continue;
    const full = (f) => (f.group_name ? `${f.group_name} — ${f.name}` : f.name);
    lines.push([esc(t.name), ...tf.flatMap((f) => [esc(full(f)), esc('')])].join(','));
    lines.push([esc('Name'), ...tf.flatMap(() => [esc('Target'), esc('Achieved')])].join(','));
    for (const row of rows.filter((x) => x.team_id === t.id)) {
      const who = personAt.get(row.user_id).name + (row.label ? ` — ${row.label}` : '');
      lines.push([esc(who), ...tf.flatMap((f) => {
        const c = cellAt.get(`${row.id}:${f.id}`);
        return [esc(c?.target || ''), esc(c?.achieved || '')];
      })].join(','));
    }
    lines.push('');
  }

  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="scorecard-${cycle}.csv"`);
  res.send(lines.join('\n'));
});

export default r;
