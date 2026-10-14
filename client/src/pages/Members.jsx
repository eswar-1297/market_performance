import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Alert, Empty, Field, Modal } from '../components/ui.jsx';

export default function Members() {
  const { refresh } = useApp();
  const [users, setUsers] = useState(null);
  const [teams, setTeams] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = () => Promise.all([api.users(), api.teams()])
    .then(([u, t]) => { setUsers(u); setTeams(t); })
    .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  if (!users) return <div className="muted">Loading…</div>;

  // The people on the sheet: no deactivated accounts, and neither the lead nor
  // the read-only stakeholder, who are not tracked on it.
  const shown = users.filter((u) => u.active && u.role === 'member');

  return (
    <>
      {error && <Alert onDismiss={() => setError('')}>{error}</Alert>}

      <div className="filters">
        <span className="muted small">
          {shown.length} {shown.length === 1 ? 'person' : 'people'} on the sheet
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn primary sm" onClick={() => setEditing({ new: true })}>+ Add member</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Designation</th><th>Team</th>
                <th>Reports to</th><th>Email</th><th></th></tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.name}</td>
                  <td className="small">{u.designation || '—'}</td>
                  <td>
                    {u.team_name ? (
                      <span className="row" style={{ gap: 6 }}>
                        <i className="dot" style={{ background: u.team_colour }} />
                        <span className="small">{u.team_name}</span>
                      </span>
                    ) : <span className="faint small">—</span>}
                  </td>
                  <td className="small">{u.reports_to || '—'}</td>
                  <td className="small faint">{u.email}</td>
                  <td className="nowrap">
                    <button className="btn sm" onClick={() => setEditing(u)}>Edit</button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={6}><Empty title="No members yet" /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <MemberModal member={editing.new ? null : editing} teams={teams} users={users}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); refresh(); }} />
      )}
    </>
  );
}

function MemberModal({ member, teams, users, onClose, onSaved }) {
  const [f, setF] = useState(member || {
    name: '', email: '', role: 'member', designation: '',
    team_id: '', reports_to: '', active: 1,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    setBusy(true); setError('');
    try {
      const body = { ...f, team_id: f.team_id || null };
      if (member?.id) {
        await api.updateUser(member.id, body);
      } else {
        await api.createUser(body);
      }
      onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const deactivate = async () => {
    if (!window.confirm(`Deactivate ${f.name}? They keep their history but drop off the sheet.`)) return;
    try { await api.deactivateUser(member.id); onSaved(); } catch (e) { setError(e.message); }
  };

  return (
    <Modal title={member ? `Edit ${member.name}` : 'Add a member'} onClose={onClose} footer={<>
      {member && !!member.active && <button className="btn danger" onClick={deactivate}>Deactivate</button>}
      <div style={{ flex: 1 }} />
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save}
        disabled={busy || !f.name.trim() || !f.email.trim()}>
        {busy ? 'Saving…' : 'Save member'}
      </button>
    </>}>
      <Alert onDismiss={() => setError('')}>{error}</Alert>

      <div className="form-2">
        <Field label="Full name"><input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Designation">
          <input value={f.designation || ''} onChange={set('designation')} placeholder="Senior Technical Content Writer" />
        </Field>
        <Field label="Team">
          <select value={f.team_id || ''} onChange={set('team_id')}>
            <option value="">No team</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Reports to">
          <select value={f.reports_to || ''} onChange={set('reports_to')}>
            <option value="">—</option>
            {users.filter((u) => u.name !== f.name).map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
          </select>
        </Field>
      </div>

      {member && !member.active && (
        <Field>
          <label className="row small" style={{ gap: 7 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={!!f.active}
              onChange={(e) => setF((s) => ({ ...s, active: e.target.checked ? 1 : 0 }))} />
            Reactivate this member
          </label>
        </Field>
      )}
    </Modal>
  );
}
