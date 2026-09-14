import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Alert, Bar, Empty, Field, Modal, fmtMonth } from '../components/ui.jsx';

const PALETTE = ['#2563eb', '#059669', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#ca8a04'];

export default function Teams() {
  const { cycle, isLead, refresh } = useApp();
  const [teams, setTeams] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [members, setMembers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = () => Promise.all([api.teams(), api.users(), api.scorecard(cycle)])
    .then(([t, u, s]) => { setTeams(t); setMembers(u); setSheet(s); })
    .catch((e) => setError(e.message));

  useEffect(() => { load(); }, [cycle]);

  if (!teams || !sheet) return <div className="muted">Loading…</div>;

  return (
    <>
      {error && <Alert onDismiss={() => setError('')}>{error}</Alert>}

      <div className="filters">
        <span className="muted small">Sheet progress for <b>{fmtMonth(cycle)}</b></span>
        <div style={{ flex: 1 }} />
        {isLead && <button className="btn primary sm" onClick={() => setEditing({ new: true })}>+ New team</button>}
      </div>

      <div className="grid g2">
        {teams.map((t) => {
          const roster = members.filter((m) => m.team_id === t.id);
          const s = sheet.teams.find((x) => x.id === t.id);
          const pct = s?.total_cells ? Math.round((s.filled_cells / s.total_cells) * 100) : 0;
          return (
            <div className="card" key={t.id}>
              <header>
                <i className="dot" style={{ background: t.colour }} />
                <h3>{t.name}</h3>
                <div className="spacer" />
                {isLead && <button className="btn sm" onClick={() => setEditing(t)}>Edit</button>}
              </header>
              <div className="body">
                <p className="muted small" style={{ marginTop: 0 }}>{t.description}</p>

                <div className="row" style={{ gap: 18, marginBottom: 12 }}>
                  <Stat label="People" value={roster.length} />
                  <Stat label="Columns" value={s?.fields.length ?? 0} />
                  <Stat label="Filled in" value={s?.filled_cells ?? 0} tone="var(--green)" />
                  <Stat label="Blank" value={(s?.total_cells ?? 0) - (s?.filled_cells ?? 0)}
                    tone={(s?.total_cells ?? 0) - (s?.filled_cells ?? 0) ? 'var(--amber)' : undefined} />
                </div>

                <Bar value={pct} colour={t.colour} />
                <div className="faint small" style={{ marginTop: 5 }}>
                  {pct}% of this month sheet filled in
                </div>

                {s?.fields.length > 0 && (
                  <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <div className="muted small" style={{ fontWeight: 650, marginBottom: 7 }}>
                      What this team is measured on
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      {s.fields.map((f) => <span className="badge grey" key={f.id}>{f.name}</span>)}
                    </div>
                    <div className="faint small" style={{ marginTop: 7 }}>
                      Columns are added and renamed on the Dashboard.
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <div className="muted small" style={{ fontWeight: 650, marginBottom: 7 }}>Roster</div>
                  {roster.length === 0 ? <div className="faint small">No members yet.</div> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {roster.map((m) => (
                        <div className="row small" key={m.id} style={{ justifyContent: 'space-between' }}>
                          <span>{m.name}</span>
                          <span className="faint">{m.designation}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {teams.length === 0 && (
          <div className="card"><Empty title="No teams yet" hint="Create one to start tracking." /></div>
        )}
      </div>

      {editing && (
        <TeamModal team={editing.new ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); refresh(); }} />
      )}
    </>
  );
}

const Stat = ({ label, value, tone }) => (
  <div>
    <div style={{ fontSize: 20, fontWeight: 700, color: tone }}>{value}</div>
    <div className="faint small">{label}</div>
  </div>
);

function TeamModal({ team, onClose, onSaved }) {
  const [f, setF] = useState(team || { name: '', description: '', colour: PALETTE[0], sort_order: 99 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    setBusy(true); setError('');
    try {
      if (team?.id) await api.updateTeam(team.id, f);
      else await api.createTeam(f);
      onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete the team "${f.name}"?`)) return;
    try { await api.deleteTeam(team.id); onSaved(); } catch (e) { setError(e.message); }
  };

  return (
    <Modal title={team ? 'Edit team' : 'New team'} onClose={onClose} footer={<>
      {team && <button className="btn danger" onClick={remove}>Delete</button>}
      <div style={{ flex: 1 }} />
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={busy || !f.name.trim()}>
        {busy ? 'Saving…' : 'Save team'}
      </button>
    </>}>
      <Alert onDismiss={() => setError('')}>{error}</Alert>
      <Field label="Team name"><input value={f.name} onChange={set('name')} autoFocus /></Field>
      <Field label="What this team owns">
        <textarea value={f.description || ''} onChange={set('description')} />
      </Field>
      <div className="form-2">
        <Field label="Colour">
          <div className="row">
            {PALETTE.map((c) => (
              <button key={c} type="button" onClick={() => setF((s) => ({ ...s, colour: c }))}
                style={{
                  width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer',
                  border: f.colour === c ? '3px solid #0f172a' : '1px solid #e2e8f0',
                }} />
            ))}
          </div>
        </Field>
        <Field label="Display order" hint="Lower numbers appear first.">
          <input type="number" value={f.sort_order ?? 99} onChange={set('sort_order')} />
        </Field>
      </div>
    </Modal>
  );
}
