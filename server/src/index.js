import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import db, { ROOT } from './db.js';
import users from './routes/users.js';
import teams from './routes/teams.js';
import tasks from './routes/tasks.js';
import targets from './routes/targets.js';
import scorecard from './routes/scorecard.js';
import attachments from './routes/attachments.js';
import reports from './routes/reports.js';

const app = express();
const PORT = process.env.PORT || 4100;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api', users);
app.use('/api', teams);
app.use('/api', tasks);
app.use('/api', targets);
app.use('/api', scorecard);
app.use('/api', attachments);
app.use('/api', reports);

// Serve the built React app when it exists, so `npm start` alone is enough in production.
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

const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
app.listen(PORT, () => {
  console.log(`\n  Marketing Performance Tracker API  →  http://localhost:${PORT}`);
  if (!userCount) console.log('  No users yet. Run:  npm run seed\n');
  else console.log(`  ${userCount} user account(s) loaded.\n`);
});
