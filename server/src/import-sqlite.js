/**
 * Copies a sheet out of the old SQLite file and into Postgres — teams, people
 * (with their current passwords), columns, rows and every filled-in box.
 *
 * Run once, against an empty or freshly seeded Postgres:
 *     npm run import-sqlite            (reads ./data.db)
 *     npm run import-sqlite -- path/to/data.db
 *
 * Matching is by name and email, so running it twice updates rather than
 * duplicates. Boxes are overwritten from the SQLite copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { q, one, pool, initSchema } from './db.js';

const require = createRequire(import.meta.url);
const file = path.resolve(process.argv[2] || 'data.db');

async function main() {
  if (!fs.existsSync(file)) {
    console.error(`\n  No SQLite file at ${file}\n`);
    process.exitCode = 1;
    return;
  }

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    console.error('\n  better-sqlite3 is not installed — run:  npm install --include=dev\n');
    process.exitCode = 1;
    return;
  }

  await initSchema();
  const old = new Database(file, { readonly: true });
  const has = (t) => !!old.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(t);
  if (!has('scorecard_cells')) {
    console.error('\n  That file has no sheet in it.\n');
    process.exitCode = 1;
    return;
  }

  const counts = { teams: 0, users: 0, fields: 0, rows: 0, cells: 0 };
  const teamId = new Map();   // old id -> new id
  const userId = new Map();
  const fieldId = new Map();
  const rowId = new Map();

  for (const t of old.prepare('SELECT * FROM teams ORDER BY id').all()) {
    const row = await one(
      `INSERT INTO teams (name, slug, description, colour, sort_order)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (name) DO UPDATE SET colour = EXCLUDED.colour, sort_order = EXCLUDED.sort_order
       RETURNING id`,
      [t.name, t.slug, t.description || '', t.colour, t.sort_order],
    );
    teamId.set(t.id, row.id); counts.teams += 1;
  }

  for (const u of old.prepare('SELECT * FROM users ORDER BY id').all()) {
    const row = await one(
      `INSERT INTO users (name, email, password_hash, role, designation, team_id, reports_to, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
         designation = EXCLUDED.designation, team_id = EXCLUDED.team_id,
         reports_to = EXCLUDED.reports_to, active = EXCLUDED.active
       RETURNING id`,
      [u.name, String(u.email).toLowerCase(), u.password_hash, u.role, u.designation || '',
        u.team_id ? teamId.get(u.team_id) : null, u.reports_to || '', !!u.active],
    );
    userId.set(u.id, row.id); counts.users += 1;
  }

  const fieldCols = old.prepare('PRAGMA table_info(scorecard_fields)').all().map((c) => c.name);
  for (const f of old.prepare('SELECT * FROM scorecard_fields ORDER BY sort_order, id').all()) {
    const group = fieldCols.includes('group_name') ? (f.group_name || '') : '';
    const row = await one(
      `INSERT INTO scorecard_fields (team_id, group_name, name, direction, sort_order)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (team_id, group_name, name) DO UPDATE SET
         direction = EXCLUDED.direction, sort_order = EXCLUDED.sort_order
       RETURNING id`,
      [teamId.get(f.team_id), group, f.name,
        fieldCols.includes('direction') ? (f.direction || 'up') : 'up', f.sort_order],
    );
    fieldId.set(f.id, row.id); counts.fields += 1;
  }

  if (has('scorecard_rows')) {
    const rowCols = old.prepare('PRAGMA table_info(scorecard_rows)').all().map((c) => c.name);
    for (const rw of old.prepare('SELECT * FROM scorecard_rows ORDER BY user_id, sort_order, id').all()) {
      const user = userId.get(rw.user_id);
      if (!user) continue;
      const team = rowCols.includes('team_id') && rw.team_id ? teamId.get(rw.team_id) : null;
      const existing = await one(
        `SELECT id FROM scorecard_rows
         WHERE user_id = $1 AND label = $2 AND team_id IS NOT DISTINCT FROM $3
         ORDER BY id LIMIT 1`,
        [user, rw.label || '', team],
      );
      const row = existing || await one(
        'INSERT INTO scorecard_rows (user_id, team_id, label, sort_order) VALUES ($1,$2,$3,$4) RETURNING id',
        [user, team, rw.label || '', rw.sort_order || 0],
      );
      rowId.set(rw.id, row.id); counts.rows += 1;
    }
  }

  const cellCols = old.prepare('PRAGMA table_info(scorecard_cells)').all().map((c) => c.name);
  for (const c of old.prepare('SELECT * FROM scorecard_cells').all()) {
    const field = fieldId.get(c.field_id);
    if (!field) continue;

    let row;
    if (cellCols.includes('row_id')) row = rowId.get(c.row_id);
    else if (userId.get(c.user_id)) {
      // Older files hung cells straight off a person.
      const found = await one(
        'SELECT id FROM scorecard_rows WHERE user_id = $1 ORDER BY sort_order, id LIMIT 1',
        [userId.get(c.user_id)],
      );
      row = found?.id || (await one(
        "INSERT INTO scorecard_rows (user_id, label, sort_order) VALUES ($1,'',0) RETURNING id",
        [userId.get(c.user_id)],
      )).id;
    }
    if (!row) continue;

    await q(
      `INSERT INTO scorecard_cells (cycle, row_id, field_id, target, achieved)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (cycle, row_id, field_id) DO UPDATE SET
         target = EXCLUDED.target, achieved = EXCLUDED.achieved, updated_at = now()`,
      [c.cycle, row, field, c.target || '', c.achieved || ''],
    );
    counts.cells += 1;
  }

  const { filled } = await one(
    `SELECT COUNT(*)::int AS filled FROM scorecard_cells WHERE target <> '' OR achieved <> ''`,
  );
  console.log(`
  Imported from ${file}
  ${'-'.repeat(14 + file.length)}
  Teams   : ${counts.teams}
  People  : ${counts.users}
  Columns : ${counts.fields}
  Rows    : ${counts.rows}
  Boxes   : ${counts.cells} copied, ${filled} of them with something in
`);
}

main()
  .catch((e) => { console.error('\n  Import failed:', e.message, '\n'); process.exitCode = 1; })
  .finally(() => pool.end());
