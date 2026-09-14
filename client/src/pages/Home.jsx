import React, { useEffect, useMemo, useState } from 'react';
import { api, downloadWithAuth } from '../api.js';
import { useApp } from '../App.jsx';
import { Alert, fmtMonth } from '../components/ui.jsx';
import Scorecard from './Scorecard.jsx';

/**
 * The one screen: three numbers, a button per team, and the month sheet —
 * a row per person with Target and Achieved under every column.
 */
export default function Home() {
  const { cycle, isLead, isStakeholder, refreshKey } = useApp();
  const [sheet, setSheet] = useState(null);
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState('');

  const load = () => api.scorecard(cycle).then(setSheet).catch((e) => setError(e.message));

  useEffect(() => { load(); }, [cycle, refreshKey]);

  const shown = useMemo(() => {
    if (!sheet) return [];
    return teamId ? sheet.teams.filter((t) => String(t.id) === String(teamId)) : sheet.teams;
  }, [sheet, teamId]);

  if (!sheet) return <div className="muted">Loading…</div>;

  const people = shown.reduce((n, x) => n + x.people, 0);
  const lines = shown.reduce((n, x) => n + x.rows.length, 0);
  const filled = shown.reduce((n, x) => n + x.filled_cells, 0);
  const cells = shown.reduce((n, x) => n + x.total_cells, 0);

  return (
    <>
      {error && <Alert onDismiss={() => setError('')}>{error}</Alert>}

      <div className="tiles">
        <Tile label={lines === people ? 'People tracked' : `People tracked (${lines} rows)`} value={people} />
        <Tile label="Boxes filled in" value={filled} tone={filled ? 'green' : undefined} />
        <Tile label="Still blank" value={cells - filled} tone={cells - filled ? 'amber' : undefined} />
      </div>

      <div className="teamrow">
        <button className={`teambtn${teamId === '' ? ' on' : ''}`} onClick={() => setTeamId('')}>
          <b>All teams</b>
          <span>{sheet.teams.reduce((n, x) => n + x.people, 0)} people</span>
        </button>
        {sheet.teams.map((x) => (
          <button
            key={x.id}
            className={`teambtn${String(teamId) === String(x.id) ? ' on' : ''}`}
            style={{ '--c': x.colour }}
            onClick={() => setTeamId(String(x.id))}
          >
            <b>{x.name}</b>
            <span>{x.filled_cells} of {x.total_cells} filled</span>
          </button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="muted small">
          <b>{fmtMonth(cycle)}</b> — type into a box, it saves when you click away
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn sm" title="Download this sheet as a spreadsheet"
          onClick={() => downloadWithAuth(api.exportUrl('scorecard', cycle), `sheet-${cycle}.csv`)}>
          ⬇ Export
        </button>
      </div>

      <Scorecard teams={shown} allTeams={sheet.teams} cycle={cycle} isLead={isLead}
        isStakeholder={isStakeholder} onSaved={load} />
    </>
  );
}

function Tile({ label, value, tone }) {
  const colour = { green: 'var(--green)', red: 'var(--red)', amber: 'var(--amber)' }[tone];
  return (
    <div className="tile">
      <div className="v" style={colour ? { color: colour } : undefined}>{value ?? 0}</div>
      <div className="l">{label}</div>
    </div>
  );
}
