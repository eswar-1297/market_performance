import pg from 'pg';

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('\n  DATABASE_URL is not set.\n');
  console.error('  Point it at a Postgres database, for example:');
  console.error('    postgres://user:password@host:5432/marketing\n');
  console.error('  On Render the blueprint wires this up for you. Locally, put it on one');
  console.error('  line in server/.env:   DATABASE_URL=postgres://…\n');
  process.exit(1);
}

// Hosted Postgres wants TLS; a database on this machine does not.
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

export const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 8,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => console.error('Postgres pool error:', err.message));

/** Rows for a query. Values go in as $1, $2, … — never string-concatenated. */
export const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

/** The first row, or null. */
export const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0] ?? null;

/** Runs fn inside a transaction, handing it a client to query with. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/* ---------------------------------------------------------------- schema */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  colour      TEXT NOT NULL DEFAULT '#4f46e5',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',        -- lead | member | stakeholder
  designation   TEXT NOT NULL DEFAULT '',
  team_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  reports_to    TEXT NOT NULL DEFAULT '',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One column of a team's sheet. group_name nests it under a heading, so
-- "open rate" and "click through rate" both sit under "Newsletter".
CREATE TABLE IF NOT EXISTS scorecard_fields (
  id         SERIAL PRIMARY KEY,
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL,
  direction  TEXT NOT NULL DEFAULT 'up',               -- up | down (down = lower is better)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, group_name, name)
);

-- One line of the sheet: a person, on their own team's sheet or another's, and
-- one of possibly several lines for that person. Rows outlive a month.
CREATE TABLE IF NOT EXISTS scorecard_rows (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id    INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  label      TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What somebody aimed for and what they hit, for one column in one month.
-- Both are free text on purpose: "20%", "ENT", "US, UK, Canada".
CREATE TABLE IF NOT EXISTS scorecard_cells (
  id         SERIAL PRIMARY KEY,
  cycle      TEXT NOT NULL,                            -- YYYY-MM
  row_id     INTEGER NOT NULL REFERENCES scorecard_rows(id) ON DELETE CASCADE,
  field_id   INTEGER NOT NULL REFERENCES scorecard_fields(id) ON DELETE CASCADE,
  target     TEXT NOT NULL DEFAULT '',
  achieved   TEXT NOT NULL DEFAULT '',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle, row_id, field_id)
);

CREATE TABLE IF NOT EXISTS activity (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What somebody worked on, one entry per piece of work on a day: the link to it
-- (a blog, a landing page, a post) and a line on what was done.
CREATE TABLE IF NOT EXISTS daily_tasks (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_date   DATE NOT NULL,
  url         TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Whether the piece of work got finished that day: 'in_progress' or 'done'.
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'in_progress';

-- Files kept in the database itself, so they survive a hosted restart that
-- would wipe the server's disk.
CREATE TABLE IF NOT EXISTS task_attachments (
  id            SERIAL PRIMARY KEY,
  task_id       INTEGER NOT NULL REFERENCES daily_tasks(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  data          BYTEA NOT NULL,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON daily_tasks(user_id, task_date);
CREATE INDEX IF NOT EXISTS idx_tasks_date      ON daily_tasks(task_date);
CREATE INDEX IF NOT EXISTS idx_attach_task     ON task_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_cells_cycle ON scorecard_cells(cycle);
CREATE INDEX IF NOT EXISTS idx_rows_user   ON scorecard_rows(user_id);
CREATE INDEX IF NOT EXISTS idx_fields_team ON scorecard_fields(team_id);
`;

/** Creates the tables if they are not there yet. Safe on every boot. */
export async function initSchema() {
  await pool.query(SCHEMA);
}

/* ------------------------------------------------- the starter columns */

// The columns each team is measured on, straight off the team's own sheet.
// "Heading > column" nests a column under a heading; a name suffixed with ↓ is
// one where a lower number is the better result.
export const DEFAULT_FIELDS = {
  'Content Team': ['Leads', 'Business Size', 'Case studies', 'Blogs', 'Region', 'Revenue'],
  'PPC': ['Leads', 'CPL↓', 'Region', 'Business Size'],
  'SEO/GEO Team': ['Traffic', 'Newsletter > open rate', 'Newsletter > click through rate',
    'Webinar > no of registrations', 'Guest blog', 'Leads'],
  'Wordpress Team': ['Core webvitals', '404↓', '301↓', 'Website performance'],
  'Design Team': ['No of images', 'Landing pages', 'Whitepapers', 'Case studies', 'Avg turn around time↓'],
  'Business Development': ['Leads', 'Meetings', 'Revenue', 'Region'],
};

/** "Newsletter > open rate" and "CPL↓" into the columns they describe. */
export function parseField(raw) {
  let text = String(raw);
  const direction = text.endsWith('↓') ? 'down' : 'up';
  if (direction === 'down') text = text.slice(0, -1);
  const [group, name] = text.includes('>') ? text.split('>') : ['', text];
  return { group_name: group.trim(), name: name.trim(), direction };
}

/** Only ever fills in columns for a database that has none. */
export async function seedDefaultFields() {
  const { count } = await one('SELECT COUNT(*)::int AS count FROM scorecard_fields');
  if (count) return 0;
  let n = 0;
  for (const team of await q('SELECT id, name FROM teams ORDER BY sort_order, id')) {
    const wanted = DEFAULT_FIELDS[team.name] || [];
    for (let i = 0; i < wanted.length; i += 1) {
      const f = parseField(wanted[i]);
      await q(`INSERT INTO scorecard_fields (team_id, group_name, name, direction, sort_order)
               VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [team.id, f.group_name, f.name, f.direction, i + 1]);
      n += 1;
    }
  }
  return n;
}

export async function logActivity({ user_id = null, action, detail = '' }) {
  try {
    await q('INSERT INTO activity (user_id, action, detail) VALUES ($1,$2,$3)', [user_id, action, detail]);
  } catch (e) {
    console.error('activity log failed:', e.message);   // never fail a request over the log
  }
}

export default { q, one, tx, pool };
