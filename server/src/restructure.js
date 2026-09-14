/**
 * Reshapes the sheet to the marketing team's own layout: their team names,
 * their columns in their order, and Rahul on both the PPC and SEO/GEO sheets.
 *
 * Safe to run more than once — it matches on names, never on ids, and refuses
 * to drop a column that has anything filled in under it.
 *
 * Run:  npm run restructure
 */
import db, { DEFAULT_FIELDS, parseField, seedDefaultFields } from './db.js';

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

const teamByName = (name) => db.prepare('SELECT * FROM teams WHERE name = ?').get(name);
const log = [];

db.transaction(() => {
  /* ------------------------------------------------------------- teams */
  TEAMS.forEach(([from, to, colour], i) => {
    const order = i + 1;
    const existing = (from && teamByName(from)) || teamByName(to);
    if (existing) {
      if (existing.name !== to) log.push(`renamed team "${existing.name}" -> "${to}"`);
      db.prepare('UPDATE teams SET name = ?, slug = ?, colour = ?, sort_order = ? WHERE id = ?')
        .run(to, slugify(to), colour, order, existing.id);
    } else {
      db.prepare('INSERT INTO teams (name, slug, description, colour, sort_order) VALUES (?,?,?,?,?)')
        .run(to, slugify(to), '', colour, order);
      log.push(`created team "${to}"`);
    }
  });
  // Anything not on the sheet sorts after it, untouched.
  db.prepare(`UPDATE teams SET sort_order = 90 + id WHERE name NOT IN (${TEAMS.map(() => '?').join(',')})`)
    .run(...TEAMS.map(([, to]) => to));

  /* ----------------------------------------------------------- columns */
  for (const [, teamName] of TEAMS) {
    const team = teamByName(teamName);
    const wanted = (DEFAULT_FIELDS[teamName] || []).map(parseField);
    const have = db.prepare('SELECT * FROM scorecard_fields WHERE team_id = ?').all(team.id);

    wanted.forEach((w, i) => {
      // "Core web vitals" and "Core webvitals" are the same column renamed.
      const flat = (t) => String(t).replace(/\s+/g, '').toLowerCase();
      const match = have.find((h) => h.group_name === w.group_name && h.name === w.name)
        || have.find((h) => flat(h.group_name + h.name) === flat(w.group_name + w.name))
        || have.find((h) => !h.group_name && flat(h.name) === flat(w.group_name + w.name));
      const full = (f) => (f.group_name ? `${f.group_name} — ${f.name}` : f.name);
      if (match) {
        if (match.name !== w.name || match.group_name !== w.group_name) {
          log.push(`renamed column "${full(match)}" -> "${full(w)}" (${teamName})`);
        }
        db.prepare('UPDATE scorecard_fields SET group_name = ?, name = ?, direction = ?, sort_order = ? WHERE id = ?')
          .run(w.group_name, w.name, w.direction, i + 1, match.id);
      } else {
        db.prepare('INSERT INTO scorecard_fields (team_id, group_name, name, direction, sort_order) VALUES (?,?,?,?,?)')
          .run(team.id, w.group_name, w.name, w.direction, i + 1);
        log.push(`added column "${full(w)}" to ${teamName}`);
      }
    });

    // Drop columns the sheet does not have — unless something is filled in.
    const keep = new Set(wanted.map((w) => `${w.group_name}|${w.name}`));
    for (const h of db.prepare('SELECT * FROM scorecard_fields WHERE team_id = ?').all(team.id)) {
      if (keep.has(`${h.group_name}|${h.name}`)) continue;
      const used = db.prepare(
        `SELECT COUNT(*) AS n FROM scorecard_cells WHERE field_id = ? AND (target <> '' OR achieved <> '')`
      ).get(h.id).n;
      if (used) {
        log.push(`KEPT column "${h.name}" on ${teamName} — ${used} box(es) filled in, delete it by hand if you want it gone`);
        continue;
      }
      db.prepare('DELETE FROM scorecard_fields WHERE id = ?').run(h.id);
      log.push(`removed empty column "${h.name}" from ${teamName}`);
    }
  }

  /* -------------------------------------------------------------- rows */
  for (const [email, teamName] of EXTRA_ROWS) {
    const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
    const team = teamByName(teamName);
    if (!user || !team) { log.push(`skipped extra row: ${email} / ${teamName} not found`); continue; }
    if (db.prepare('SELECT 1 FROM scorecard_rows WHERE user_id = ? AND team_id = ?').get(user.id, team.id)) continue;
    // Their own team's row first, so the borrowed one sorts underneath.
    if (!db.prepare('SELECT 1 FROM scorecard_rows WHERE user_id = ?').get(user.id)) {
      db.prepare('INSERT INTO scorecard_rows (user_id, label, sort_order) VALUES (?,?,0)').run(user.id, '');
    }
    const next = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM scorecard_rows WHERE user_id = ?')
      .get(user.id).n;
    db.prepare('INSERT INTO scorecard_rows (user_id, team_id, label, sort_order) VALUES (?,?,?,?)')
      .run(user.id, team.id, '', next);
    log.push(`put ${user.name} on the ${teamName} sheet as well`);
  }
})();

seedDefaultFields();

console.log(`\n  Sheet reshaped\n  --------------`);
for (const line of log) console.log(`  ${line}`);
if (!log.length) console.log('  nothing to change — already matches the sheet');

const teams = db.prepare('SELECT * FROM teams ORDER BY sort_order, name').all();
console.log('\n  Now:');
for (const t of teams) {
  const cols = db.prepare('SELECT group_name, name, direction FROM scorecard_fields WHERE team_id = ? ORDER BY sort_order, id')
    .all(t.id).map((f) => (f.group_name ? `${f.group_name} > ${f.name}` : f.name)
      + (f.direction === 'down' ? '↓' : '')).join(', ');
  const who = db.prepare(`
    SELECT u.name FROM scorecard_rows r JOIN users u ON u.id = r.user_id
    WHERE r.team_id = ? UNION
    SELECT u.name FROM users u WHERE u.team_id = ? AND u.active = 1 AND u.role <> 'stakeholder'
      AND NOT EXISTS (SELECT 1 FROM scorecard_rows r2 WHERE r2.user_id = u.id AND r2.team_id IS NOT NULL
                      AND r2.team_id <> ?)`).all(t.id, t.id, t.id).map((x) => x.name).join(', ');
  console.log(`  ${t.name}\n     columns: ${cols || '(none)'}\n     people : ${who || '(none)'}`);
}
console.log('');
