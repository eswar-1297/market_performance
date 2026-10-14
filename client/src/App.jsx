import React, { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Review from './pages/Review.jsx';
import Tasks from './pages/Tasks.jsx';
import Teams from './pages/Teams.jsx';
import Members from './pages/Members.jsx';
import Account from './pages/Account.jsx';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const PAGES = {
  '/': ['Monthly Sheet', 'Target and achieved, one row per person'],
  '/tasks': ['Daily Tasks', 'What each person worked on, and the month added up'],
  '/review': ['Monthly Review', 'The saved sheet for the month, ready to print'],
  '/teams': ['Teams', 'Rosters, columns and how much of the sheet is filled in'],
  '/members': ['Members', 'People, roles and sign-in access'],
  '/account': ['My Account', 'Your sign-in details'],
};

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [cycle, setCycle] = useState(new Date().toISOString().slice(0, 7));
  const [cycles, setCycles] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const location = useLocation();

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    if (!getToken()) { setBooting(false); return; }
    api.me()
      .then(({ user }) => setUser(user))
      .catch(() => setToken(null))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    api.cycles().then(setCycles).catch(() => {});
  }, [user, refreshKey]);

  if (booting) return <div style={{ padding: 40, color: '#64748b' }}>Loading…</div>;
  if (!user) return <Login onSignedIn={setUser} />;

  const signOut = () => { setToken(null); setUser(null); };
  const isLead = user.role === 'lead';
  const isStakeholder = user.role === 'stakeholder';
  const [title, subtitle] = PAGES[location.pathname] || ['Marketing Performance Tracker', ''];

  return (
    <AppCtx.Provider value={{ user, isLead, isStakeholder, cycle, setCycle, cycles, refresh, refreshKey }}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <b>Marketing Performance</b>
            <span>CloudFuze</span>
          </div>
          <nav>
            <NavLink to="/" end>📋 Monthly Sheet</NavLink>
            <NavLink to="/tasks">🗓️ Daily Tasks</NavLink>
            <NavLink to="/review">📈 Monthly Review</NavLink>
            {isLead && (
              <>
                <div className="group">Setup</div>
                <NavLink to="/members">🧑 Members</NavLink>
                <NavLink to="/teams">👥 Teams</NavLink>
              </>
            )}
            {!isStakeholder && <NavLink to="/account" style={{ marginTop: 'auto' }}>⚙️ My Account</NavLink>}
          </nav>
          <div className="whoami">
            <b>{user.name}</b>
            <span>{user.designation || user.role}</span>
            <button onClick={signOut}>Sign out</button>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <div>
              <h1>{title}</h1>
              <div className="sub">{subtitle}</div>
            </div>
            <div className="spacer" />
            <label className="small muted nowrap" htmlFor="cycle">Month</label>
            <input id="cycle" type="month" value={cycle} style={{ width: 165 }}
              onChange={(e) => e.target.value && setCycle(e.target.value)} />
          </header>

          <main className="page">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/review" element={<Review />} />
              <Route path="/teams" element={isLead ? <Teams /> : <Navigate to="/" replace />} />
              <Route path="/members" element={isLead ? <Members /> : <Navigate to="/" replace />} />
              <Route path="/account" element={<Account />} />
              {/* Old ticket, target and boardroom links all land on the sheet. */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </AppCtx.Provider>
  );
}
