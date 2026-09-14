const TOKEN_KEY = 'mpt.token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function request(path, { method = 'GET', body, raw } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body && !raw) headers['content-type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    setToken(null);
    window.location.reload();
    throw new Error('Session expired');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

const qs = (params = {}) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : '';
};

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/auth/me'),
  changePassword: (b) => request('/auth/password', { method: 'POST', body: b }),

  cycles: () => request('/cycles'),

  // The monthly sheet: columns per team, and a target/achieved cell per person.
  scorecard: (cycle) => request(`/scorecard${qs({ cycle })}`),
  review: (cycle) => request(`/review${qs({ cycle })}`),
  saveCell: (b) => request('/scorecard/cell', { method: 'PUT', body: b }),
  addRow: (b) => request('/scorecard/rows', { method: 'POST', body: b }),
  deleteRow: (id) => request(`/scorecard/rows/${id}`, { method: 'DELETE' }),
  addField: (b) => request('/scorecard/fields', { method: 'POST', body: b }),
  addSubField: (id, b) => request(`/scorecard/fields/${id}/sub`, { method: 'POST', body: b }),
  renameField: (id, b) => request(`/scorecard/fields/${id}`, { method: 'PUT', body: b }),
  deleteField: (id) => request(`/scorecard/fields/${id}`, { method: 'DELETE' }),
  renameGroup: (b) => request('/scorecard/groups', { method: 'PUT', body: b }),
  deleteGroup: (params) => request(`/scorecard/groups${qs(params)}`, { method: 'DELETE' }),

  teams: (cycle) => request(`/teams${qs({ cycle })}`),
  createTeam: (b) => request('/teams', { method: 'POST', body: b }),
  updateTeam: (id, b) => request(`/teams/${id}`, { method: 'PUT', body: b }),
  deleteTeam: (id) => request(`/teams/${id}`, { method: 'DELETE' }),

  users: (params) => request(`/users${qs(params)}`),
  createUser: (b) => request('/users', { method: 'POST', body: b }),
  updateUser: (id, b) => request(`/users/${id}`, { method: 'PUT', body: b }),
  deactivateUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),

  exportUrl: (what, cycle) => `/api/export/${what}.csv${qs({ cycle })}`,
};

/** Downloads a protected URL by fetching it with the auth header first. */
export async function downloadWithAuth(url, filename) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
