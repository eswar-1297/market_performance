import React, { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Alert, Field } from '../components/ui.jsx';

export default function Account() {
  const { user } = useApp();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setOk('');
    if (f.new_password !== f.confirm) return setError('The two new passwords do not match');
    setBusy(true);
    try {
      await api.changePassword({ current_password: f.current_password, new_password: f.new_password });
      setOk('Password changed.');
      setF({ current_password: '', new_password: '', confirm: '' });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid g2">
      <div className="card">
        <header><h3>Your details</h3></header>
        <div className="body">
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 20px' }}>
            <dt className="muted small">Name</dt><dd style={{ margin: 0, fontWeight: 600 }}>{user.name}</dd>
            <dt className="muted small">Email</dt><dd style={{ margin: 0 }}>{user.email}</dd>
            <dt className="muted small">Designation</dt><dd style={{ margin: 0 }}>{user.designation || '—'}</dd>
            <dt className="muted small">Team</dt><dd style={{ margin: 0 }}>{user.team_name || '—'}</dd>
            <dt className="muted small">Reports to</dt><dd style={{ margin: 0 }}>{user.reports_to || '—'}</dd>
            <dt className="muted small">Access</dt><dd style={{ margin: 0 }}>{user.role}</dd>
          </dl>
          <p className="faint small" style={{ marginBottom: 0 }}>
            Only the marketing lead can change these. Ask them if something is wrong.
          </p>
        </div>
      </div>

      <form className="card" onSubmit={submit}>
        <header><h3>Change your password</h3></header>
        <div className="body">
          <Alert onDismiss={() => setError('')}>{error}</Alert>
          {ok && <Alert kind="ok">{ok}</Alert>}
          <Field label="Current password">
            <input type="password" value={f.current_password} onChange={set('current_password')} required />
          </Field>
          <Field label="New password" hint="At least 6 characters.">
            <input type="password" value={f.new_password} onChange={set('new_password')} required />
          </Field>
          <Field label="Confirm new password">
            <input type="password" value={f.confirm} onChange={set('confirm')} required />
          </Field>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
        </div>
      </form>
    </div>
  );
}
