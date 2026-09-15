/**
 * Creates the teams, the people and the starter columns on an empty database.
 *
 * Run:  npm run seed          (only seeds an empty database)
 *       npm run reseed        (wipes the people and teams and rebuilds them)
 *
 * A reseed rebuilds the teams, which takes the sheet with them, so it refuses
 * to run once anything has been filled in.
 */
import bcrypt from 'bcryptjs';
import { q, one, pool, initSchema, seedDefaultFields } from './db.js';

const FORCE = process.argv.includes('--force');
const DEFAULT_PASSWORD = 'Cloudfuze@123';

const TEAMS = [
  ['Content Team', 'Technical content, blogs, landing pages and content refresh', '#059669', 1],
  ['PPC', 'Paid search — spend, cost per lead and paid pipeline', '#0891b2', 2],
  ['SEO/GEO Team', 'Organic search, off-page, newsletters, webinars and guest blogs', '#2563eb', 3],
  ['Wordpress Team', 'WordPress development, site performance and technical SEO', '#7c3aed', 4],
  ['Design Team', 'Images, landing pages, whitepapers and collateral', '#db2777', 5],
  ['Business Development', 'Outbound, demos and pipeline generation', '#ea580c', 6],
];

// [name, email, role, designation, team, reports to]
const PEOPLE = [
  ['Arun Jyothi', 'jyothi@cloudfuze.com', 'lead', 'Marketing Manager', null, ''],
  ['Venkata Rahul', 'rahul@cloudfuze.com', 'member', 'Senior SEO & PPC Executive', 'SEO/GEO Team', 'Arun Jyothi'],
  ['Narayana Reddy', 'narayana@cloudfuze.com', 'member', 'SEO Executive', 'SEO/GEO Team', 'Arun Jyothi'],
  ['Anil', 'anil@cloudfuze.com', 'member', 'SEO Trainee Mentor', 'SEO/GEO Team', 'Venkata Rahul'],
  ['Manisha', 'manisha@cloudfuze.com', 'member', 'SEO Trainee Mentor', 'SEO/GEO Team', 'Venkata Rahul'],
  ['Pankaj Rai', 'pankaj@cloudfuze.com', 'member', 'Senior Technical Content Writer', 'Content Team', 'Arun Jyothi'],
  ['Aayushi', 'aayushi@cloudfuze.com', 'member', 'Senior Technical Content Writer', 'Content Team', 'Arun Jyothi'],
  ['Rashmi', 'rashmi@cloudfuze.com', 'member', 'Technical Content Writer', 'Content Team', 'Arun Jyothi'],
  ['Bhuvana', 'bhuvana@cloudfuze.com', 'member', 'Technical Content Writer (Trainee)', 'Content Team', 'Pankaj Rai'],
  ['Preksha', 'preksha@cloudfuze.com', 'member', 'Technical Content Writer (Trainee)', 'Content Team', 'Pankaj Rai'],
  ['Nirosh Reddy S L', 'nirosh@cloudfuze.com', 'member', 'WordPress Developer', 'Wordpress Team', 'Arun Jyothi'],
  ['Ashu Tiwary', 'ashu@cloudfuze.com', 'member', 'WordPress Developer', 'Wordpress Team', 'Arun Jyothi'],
  ['Hari Rowlo', 'hari@cloudfuze.com', 'member', 'UI/UX Designer', 'Design Team', 'Arun Jyothi'],
  ['Raj Patsamatla', 'raj@cloudfuze.com', 'member', 'Business Development Executive', 'Business Development', 'Arun Jyothi'],
  ['Abhigna', 'abhigna@cloudfuze.com', 'member', 'Business Development Executive', 'Business Development', 'Arun Jyothi'],
  ['CEO / Stakeholder', 'stakeholder@cloudfuze.com', 'stakeholder', 'Read-only board view', null, ''],
];

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  await initSchema();

  const { count } = await one('SELECT COUNT(*)::int AS count FROM users');
  if (count > 0 && !FORCE) {
    console.log('Database already has data. Use "npm run reseed" to wipe and rebuild.');
    return;
  }

  if (FORCE) {
    const { filled } = await one(
      `SELECT COUNT(*)::int AS filled FROM scorecard_cells WHERE target <> '' OR achieved <> ''`,
    );
    if (filled && !process.argv.includes('--wipe-sheet')) {
      console.log(`\n  Refusing to reseed: the monthly sheet has ${filled} box(es) filled in,`);
      console.log('  and rebuilding the teams would delete them.\n');
      console.log('  Back the database up first, then, if you really mean it:');
      console.log('      node src/seed.js --force --wipe-sheet\n');
      process.exitCode = 1;
      return;
    }
    await q('TRUNCATE scorecard_cells, scorecard_rows, scorecard_fields, activity, users, teams RESTART IDENTITY CASCADE');
  }

  const team = {};
  for (const [name, description, colour, order] of TEAMS) {
    const row = await one(
      `INSERT INTO teams (name, slug, description, colour, sort_order) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description RETURNING id`,
      [name, slugify(name), description, colour, order],
    );
    team[name] = row.id;
  }

  const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
  for (const [name, email, role, designation, teamName, reportsTo] of PEOPLE) {
    await q(
      `INSERT INTO users (name, email, password_hash, role, designation, team_id, reports_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (email) DO NOTHING`,
      [name, email, hash, role, designation, teamName ? team[teamName] : null, reportsTo],
    );
  }

  await seedDefaultFields();

  const counts = {};
  for (const t of ['teams', 'users', 'scorecard_fields']) {
    counts[t] = (await one(`SELECT COUNT(*)::int AS n FROM ${t}`)).n;
  }
  console.log(`
  Seeded
  ------
  Teams      : ${counts.teams}
  Members    : ${counts.users}
  Sheet cols : ${counts.scorecard_fields}

  Sign in with any email below, password: ${DEFAULT_PASSWORD}

    jyothi@cloudfuze.com        Marketing Manager (full access)
    rahul@cloudfuze.com         Senior SEO & PPC Executive
    stakeholder@cloudfuze.com   CEO / stakeholder (read-only)
`);
}

main()
  .catch((e) => { console.error('\n  Seed failed:', e.message, '\n'); process.exitCode = 1; })
  .finally(() => pool.end());
