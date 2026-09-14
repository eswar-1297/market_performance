import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// Everything worth keeping lives here. Locally that is server/ itself; on a
// host it is whatever DATA_DIR points at, so the database survives a redeploy.
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : ROOT;
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  colour      TEXT DEFAULT '#4f46e5',
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',   -- lead | member | stakeholder
  designation   TEXT DEFAULT '',
  team_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  reports_to    TEXT DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  description    TEXT DEFAULT '',
  team_id        INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  assignee_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_id      INTEGER REFERENCES targets(id) ON DELETE SET NULL,
  start_date     TEXT,
  end_date       TEXT,
  completed_on   TEXT,
  status         TEXT NOT NULL DEFAULT 'Not Started', -- Not Started|In Progress|Blocked|In Review|Completed|Cancelled
  priority       TEXT NOT NULL DEFAULT 'Medium',      -- Low|Medium|High|Critical
  progress       INTEGER NOT NULL DEFAULT 0,          -- 0-100
  estimated_hours REAL,
  actual_hours    REAL,
  category       TEXT DEFAULT '',
  result         TEXT DEFAULT '',                     -- outcome / what was achieved
  result_metric  TEXT DEFAULT '',                     -- e.g. "Top10 kw 111 -> 118"
  impact         TEXT DEFAULT '',                     -- Low|Medium|High business impact
  blocker        TEXT DEFAULT '',
  cycle          TEXT NOT NULL,                       -- YYYY-MM the task belongs to
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS targets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  detail       TEXT DEFAULT '',
  team_id      INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  owner_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cycle        TEXT NOT NULL,                          -- YYYY-MM
  kind         TEXT NOT NULL DEFAULT 'narrative',      -- metric | narrative
  metric_name  TEXT DEFAULT '',
  unit         TEXT DEFAULT '',                        -- %, $, count, ...
  baseline     REAL,
  target_value REAL,
  current_value REAL,
  direction    TEXT DEFAULT 'up',                      -- up | down (down = lower is better)
  status       TEXT NOT NULL DEFAULT 'On Track',       -- On Track|At Risk|Off Track|Achieved|Not Started
  source       TEXT DEFAULT '',                        -- e.g. "Aug 2026 MBR - slide 2"
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  target_id     INTEGER REFERENCES targets(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'file',          -- file | link
  label         TEXT DEFAULT '',
  url           TEXT DEFAULT '',                       -- for kind=link
  original_name TEXT DEFAULT '',
  stored_name   TEXT DEFAULT '',
  mime_type     TEXT DEFAULT '',
  size_bytes    INTEGER DEFAULT 0,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  target_id  INTEGER REFERENCES targets(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle      TEXT NOT NULL,
  team_id    INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  metric     TEXT NOT NULL,
  value      REAL,
  unit       TEXT DEFAULT '',
  note       TEXT DEFAULT '',
  UNIQUE(cycle, team_id, metric)
);

-- The monthly scorecard: one column per thing a team is measured on, and one
-- cell per person per column holding what they aimed for and what they hit.
-- Values are free text on purpose ("20%", "ENT", "US, UK, Canada").
CREATE TABLE IF NOT EXISTS scorecard_fields (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL DEFAULT '',                -- "Newsletter" over "open rate"
  name       TEXT NOT NULL,
  direction  TEXT NOT NULL DEFAULT 'up',              -- up = higher is better, down = lower is better
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(team_id, name)
);

-- One row of the sheet. Everybody has an unlabelled row; a label splits a person
-- into several rows — "US", "UK", "APAC" — so one writer can carry a line per
-- region. Rows belong to the person, not to a month, so the shape of the sheet
-- stays the same from month to month.
CREATE TABLE IF NOT EXISTS scorecard_rows (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id    INTEGER REFERENCES teams(id) ON DELETE CASCADE, -- null = the person's own team
  label      TEXT NOT NULL DEFAULT '',                -- "US", "UK", … blank until someone types one
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scorecard_cells (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle      TEXT NOT NULL,                            -- YYYY-MM
  row_id     INTEGER NOT NULL REFERENCES scorecard_rows(id) ON DELETE CASCADE,
  field_id   INTEGER NOT NULL REFERENCES scorecard_fields(id) ON DELETE CASCADE,
  target     TEXT DEFAULT '',
  achieved   TEXT DEFAULT '',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(cycle, row_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_cells_cycle    ON scorecard_cells(cycle);
CREATE INDEX IF NOT EXISTS idx_rows_user      ON scorecard_rows(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_cycle    ON tasks(cycle);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_team     ON tasks(team_id);
CREATE INDEX IF NOT EXISTS idx_targets_cycle  ON targets(cycle);
CREATE INDEX IF NOT EXISTS idx_att_task       ON attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_act_task       ON activity(task_id);
`);

/**
 * Starter scorecard columns, taken from the sheet the marketing team already keeps.
 * Only ever runs on a database that has no columns yet — the lead edits them from
 * then on, and nothing here overwrites their changes.
 */
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

export function seedDefaultFields() {
  if (db.prepare('SELECT COUNT(*) AS n FROM scorecard_fields').get().n) return 0;
  const insert = db.prepare(
    'INSERT OR IGNORE INTO scorecard_fields (team_id, group_name, name, direction, sort_order) VALUES (?,?,?,?,?)'
  );
  let n = 0;
  for (const team of db.prepare('SELECT id, name FROM teams ORDER BY sort_order, id').all()) {
    (DEFAULT_FIELDS[team.name] || []).forEach((raw, i) => {
      const f = parseField(raw);
      insert.run(team.id, f.group_name, f.name, f.direction, i + 1);
      n += 1;
    });
  }
  return n;
}

// Older databases hung cells straight off a person, one row each. Give every
// person who has cells an unlabelled row and re-point their cells at it, so
// nothing typed so far is lost.
const cellCols = db.prepare('PRAGMA table_info(scorecard_cells)').all().map((c) => c.name);
if (cellCols.includes('user_id')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    BEGIN;
    INSERT OR IGNORE INTO scorecard_rows (user_id, label, sort_order)
      SELECT DISTINCT user_id, '', 0 FROM scorecard_cells;

    CREATE TABLE scorecard_cells_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle      TEXT NOT NULL,
      row_id     INTEGER NOT NULL REFERENCES scorecard_rows(id) ON DELETE CASCADE,
      field_id   INTEGER NOT NULL REFERENCES scorecard_fields(id) ON DELETE CASCADE,
      target     TEXT DEFAULT '',
      achieved   TEXT DEFAULT '',
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(cycle, row_id, field_id)
    );
    INSERT INTO scorecard_cells_new (cycle, row_id, field_id, target, achieved, updated_by, updated_at)
      SELECT c.cycle, r.id, c.field_id, c.target, c.achieved, c.updated_by, c.updated_at
      FROM scorecard_cells c
      JOIN scorecard_rows r ON r.user_id = c.user_id AND r.label = '';

    DROP TABLE scorecard_cells;
    ALTER TABLE scorecard_cells_new RENAME TO scorecard_cells;
    CREATE INDEX IF NOT EXISTS idx_cells_cycle ON scorecard_cells(cycle);
    COMMIT;
  `);
  db.pragma('foreign_keys = ON');
}

// Rows first required a unique label per person; they are now added blank and
// labelled afterwards, so several may share a label (or have none).
const rowIndexes = db.prepare('PRAGMA index_list(scorecard_rows)').all();
if (rowIndexes.some((i) => i.unique && String(i.name).startsWith('sqlite_autoindex'))) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    BEGIN;
    CREATE TABLE scorecard_rows_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label      TEXT NOT NULL DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO scorecard_rows_new (id, user_id, label, sort_order, created_at)
      SELECT id, user_id, label, sort_order, created_at FROM scorecard_rows;
    DROP TABLE scorecard_rows;
    ALTER TABLE scorecard_rows_new RENAME TO scorecard_rows;
    CREATE INDEX IF NOT EXISTS idx_rows_user ON scorecard_rows(user_id);
    COMMIT;
  `);
  db.pragma('foreign_keys = ON');
}

// A row used to sit in whichever team its person belonged to. Carrying a team
// of its own lets one person appear on two sheets — Rahul under PPC and under
// SEO/GEO — without cloning the account.
const rowCols = db.prepare('PRAGMA table_info(scorecard_rows)').all().map((c) => c.name);
if (!rowCols.includes('team_id')) {
  db.exec('ALTER TABLE scorecard_rows ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE');
}

// Columns can now sit under a heading — "open rate" and "click through rate"
// both under "Newsletter" — so the sheet reads the way the team writes it.
if (!db.prepare('PRAGMA table_info(scorecard_fields)').all().map((c) => c.name).includes('group_name')) {
  db.exec(`ALTER TABLE scorecard_fields ADD COLUMN group_name TEXT NOT NULL DEFAULT ''`);
}

// Older databases were created before columns carried a direction.
const fieldCols = db.prepare('PRAGMA table_info(scorecard_fields)').all().map((c) => c.name);
if (!fieldCols.includes('direction')) {
  db.exec(`ALTER TABLE scorecard_fields ADD COLUMN direction TEXT NOT NULL DEFAULT 'up'`);
  db.prepare(`UPDATE scorecard_fields SET direction = 'down'
              WHERE name IN ('CPL', '404', '301', 'Bounce rate')`).run();
}

seedDefaultFields();

export function logActivity({ task_id = null, target_id = null, user_id = null, action, detail = '' }) {
  db.prepare(
    `INSERT INTO activity (task_id, target_id, user_id, action, detail) VALUES (?,?,?,?,?)`
  ).run(task_id, target_id, user_id, action, detail);
}

export default db;
