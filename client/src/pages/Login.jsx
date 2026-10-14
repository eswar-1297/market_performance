import React, { useState } from 'react';
import { api, setToken } from '../api.js';
import { Alert, Field } from '../components/ui.jsx';

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState('marketing@cloudfuze.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { token, user } = await api.login(email, password);
      setToken(token);
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>Marketing Performance Tracker</h1>
        <p className="muted small" style={{ marginTop: 0, marginBottom: 22 }}>CloudFuze, Inc</p>

        <Alert onDismiss={() => setError('')}>{error}</Alert>

        <Field label="Email">
          <input type="email" value={email} autoComplete="username"
            onChange={(e) => setEmail(e.target.value)} placeholder="marketing@cloudfuze.com" required />
        </Field>
        <Field label="Password">
          <input type="password" value={password} autoFocus autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} required />
        </Field>

        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="hint">
          The whole team signs in with one shared account:{' '}
          <code>marketing@cloudfuze.com</code>
        </div>
      </form>
    </div>
  );
}
