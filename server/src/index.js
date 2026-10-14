import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initSchema, one } from './db.js';
import { ensureSharedLogin } from './auth.js';
import users from './routes/users.js';
import teams from './routes/teams.js';
import scorecard from './routes/scorecard.js';
import tasks from './routes/tasks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 4100;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api', users);
app.use('/api', teams);
app.use('/api', scorecard);
app.use('/api', tasks);

// Serve the built React app when it exists, so one process is enough.
const clientDist = path.resolve(ROOT, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong on the server' });
});

const start = async () => {
  await initSchema();
  await ensureSharedLogin();
  const { count } = await one(`SELECT COUNT(*)::int AS count FROM users WHERE active AND team_id IS NOT NULL`);
  app.listen(PORT, () => {
    console.log(`\n  Marketing Performance Tracker API  →  http://localhost:${PORT}`);
    if (!count) console.log('  No people on the sheet yet. Run:  npm run seed\n');
    else console.log(`  ${count} people on the sheet.\n`);
  });
};

start().catch((e) => {
  console.error('\n  Could not start:', e.message, '\n');
  process.exit(1);
});
