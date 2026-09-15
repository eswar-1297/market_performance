/**
 * Reshapes the sheet to the marketing team's own layout: their team names,
 * their columns in their order, and Rahul on both the PPC and SEO/GEO sheets.
 *
 * Safe to run more than once — it matches on names, never on ids, and refuses
 * to drop a column that has anything filled in under it.
 *
 * Run:  npm run restructure
 */
import { q, one, pool, initSchema, DEFAULT_FIELDS, parseField, seedDefaultFields } from './db.js';

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Teams in sheet order: [current name (or null to create), wanted name, colour]. */
const TEAMS = [
  ['Content Writers', 'Content Team', '#059669'],
  [null, 'PPC', '#0891b2'],
  ['SEO & PPC', 'SEO/GEO Team', '#2563eb'],
  ['Developers', 'Wordpress Team', '#7c3aed'],
  ['Design', 'Design Team', '#db2777'],
];

/** Somebody who works across two teams gets a row on the second team's sheet. */
const EXTRA_ROWS = [
  ['rahul@cloudfuze.com', 'PPC'],
];

const log = [];
const teamByName = (name) => one('SELECT * FROM teams WHERE name = $1', [name]);
const flat = (t) => String(t).replace(/\s+/g, '').toLowerCase();
const full = (f) => (f.group_name ? `${f.group_name} — ${f.name}` : f.name);

async function main() {
  await initSchema();

  /* ------------------------------------------------------------- teams */
  for (let i = 0; i < TEAMS.length; i += 1) {
    const [from, to, colour] = TEAMS[i];
    const order = i + 1;
    const existing = (from && await teamByName(from)) || await teamByName(to);
    if (existing) {
      if (existing.name !== to) log.push(`renamed team "${existing.name}" -> "${to}"`);
      await q('UPDATE teams SET name = $1, slug = $2, colour = $3, sort_order = $4 WHERE id = $5',
        [to, slugify(to), colour, order, existing.id]);
    } else {
      await q(`INSERT INTO teams (name, slug, description, colour, sort_order)
               VALUES ($1,$2,'',$3,$4)`, [to, slugify(to), colour, order]);
      log.push(`created team "${to}"`);
    }
  }
  // Anything not on the sheet sorts after it, untouched.
  await q('UPDATE teams SET sort_order = 90 + id WHERE name <> ALL($1::text[])',
    [TEAMS.map(([, to]) => to)]);

  /* ----------------------------------------------------------- columns */
  for (const [, teamName] of TEAMS) {
    const team = await teamByName(teamName);
    const wanted = (DEFAULT_FIELDS[teamName] || []).map(parseField);
    const have = await q('SELECT * FROM scorecard_fields WHERE team_id = $1', [team.id]);

    for (let i = 0; i < wanted.length; i += 1) {
      const w = wanted[i];
      // "Core web vitals" and "Core webvitals" are the same column renamed, and
      // a flat "Newsletter open rate" is the same as "Newsletter > open rate".
      const match = have.find((h) => h.group_name === w.group_name && h.name === w.name)
        || have.find((h) => flat(h.group_name + h.name) === flat(w.group_name + w.name))
        || have.find((h) => !h.group_name && flat(h.name) === flat(w.group_name + w.name));
      if (match) {
        if (match.name !== w.name || match.group_name !== w.group_name) {
          log.push(`renamed column "${full(match)}" -> "${full(w)}" (${teamName})`);
        }
        await q(`UPDATE scorecard_fields SET group_name = $1, name = $2, direction = $3, sort_order = $4
                 WHERE id = $5`, [w.group_name, w.name, w.direction, i + 1, match.id]);
      } else {
        await q(`INSERT INTO scorecard_fields (team_id, group_name, name, direction, sort_order)
                 VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [team.id, w.group_name, w.name, w.direction, i + 1]);
        log.push(`added column "${full(w)}" to ${teamName}`);
      }
    }

    // Drop columns the sheet does not have — unless something is filled in.
    const keep = new Set(wanted.map((w) => `${w.group_name}|${w.name}`));
    for (const h of await q('SELECT * FROM scorecard_fields WHERE team_id = $1', [team.id])) {
      if (keep.has(`${h.group_name}|${h.name}`)) continue;
      const { used } = await one(
        `SELECT COUNT(*)::int AS used FROM scorecard_cells
         WHERE field_id = $1 AND (target <> '' OR achieved <> '')`, [h.id],
      );
      if (used) {
        log.push(`KEPT column "${full(h)}" on ${teamName} — ${used} box(es) filled in`);
        continue;
      }
      await q('DELETE FROM scorecard_fields WHERE id = $1', [h.id]);
      log.push(`removed empty column "${full(h)}" from ${teamName}`);
    }
  }

  /* -------------------------------------------------------------- rows */
  for (const [email, teamName] of EXTRA_ROWS) {
    const user = await one('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    const team = await teamByName(teamName);
    if (!user || !team) { log.push(`skipped extra row: ${email} / ${teamName} not found`); continue; }
    if (await one('SELECT 1 FROM scorecard_rows WHERE user_id = $1 AND team_id = $2', [user.id, team.id])) continue;
    if (!await one('SELECT 1 FROM scorecard_rows WHERE user_id = $1', [user.id])) {
      await q("INSERT INTO scorecard_rows (user_id, label, sort_order) VALUES ($1,'',0)", [user.id]);
    }
    const { n } = await one(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM scorecard_rows WHERE user_id = $1', [user.id],
    );
    await q("INSERT INTO scorecard_rows (user_id, team_id, label, sort_order) VALUES ($1,$2,'',$3)",
      [user.id, team.id, n]);
    log.push(`put ${user.name} on the ${teamName} sheet as well`);
  }

  await seedDefaultFields();

  console.log('\n  Sheet reshaped\n  --------------');
  for (const line of log) console.log(`  ${line}`);
  if (!log.length) console.log('  nothing to change — already matches the sheet');

  console.log('\n  Now:');
  for (const t of await q('SELECT * FROM teams ORDER BY sort_order, name')) {
    const cols = (await q(
      'SELECT group_name, name, direction FROM scorecard_fields WHERE team_id = $1 ORDER BY sort_order, id',
      [t.id],
    )).map((f) => (f.group_name ? `${f.group_name} > ${f.name}` : f.name)
      + (f.direction === 'down' ? '↓' : '')).join(', ');
    console.log(`  ${t.name}\n     columns: ${cols || '(none)'}`);
  }
  console.log('');
}

main()
  .catch((e) => { console.error('\n  Restructure failed:', e.message, '\n'); process.exitCode = 1; })
  .finally(() => pool.end());
