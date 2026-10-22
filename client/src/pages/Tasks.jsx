import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, downloadWithAuth } from '../api.js';
import { useApp } from '../App.jsx';
import { Alert, Attachments, Empty, Field, fmtMonth } from '../components/ui.jsx';

const MAX_FILE = 10 * 1024 * 1024;
const FILE_HINT = 'Images, PDF, Word, Excel, PowerPoint, CSV, ZIP · up to 10 MB each';

const today = () => new Date().toLocaleDateString('en-CA');           // YYYY-MM-DD, local
const lastDay = (cycle) => {
  const [y, m] = cycle.split('-').map(Number);
  return `${cycle}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};
const fmtDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined,
  { weekday: 'short', day: '2-digit', month: 'short' });
const STATUS_LABEL = { in_progress: 'In progress', done: 'Done' };
const doneCount = (list) => list.filter((t) => t.status === 'done').length;
const shortUrl = (u) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

function StatusField({ value, onChange }) {
  return (
    <Field label="Status">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </Field>
  );
}

async function uploadAll(taskId, files) {
  const tooBig = [...files].find((f) => f.size > MAX_FILE);
  if (tooBig) throw new Error(`${tooBig.name} is over 10 MB`);
  for (const f of files) await api.uploadAttachment(taskId, f);
}

/**
 * What each person worked on, day by day — a link and a line per piece of work,
 * with files attached — and the month added up per person.
 */
export default function Tasks() {
  const { cycle, refreshKey } = useApp();
  const [tab, setTab] = useState('log');
  const [people, setPeople] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.users().then((us) => setPeople(us.filter((u) => u.role !== 'stakeholder')))
      .catch((e) => setError(e.message));
  }, [refreshKey]);

  return (
    <>
      {error && <Alert onDismiss={() => setError('')}>{error}</Alert>}
      <div className="row no-print" style={{ marginBottom: 16 }}>
        <div className="tabs">
          <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Daily log</button>
          <button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>
            Monthly summary
          </button>
        </div>
        <div className="muted small"><b>{fmtMonth(cycle)}</b></div>
      </div>
      {tab === 'log'
        ? <DailyLog people={people} cycle={cycle} />
        : <Summary people={people} cycle={cycle} />}
    </>
  );
}

/* ------------------------------------------------------------ daily log */

const PERSON_KEY = 'mpt.taskPerson';
const remembered = () => { try { return localStorage.getItem(PERSON_KEY) || ''; } catch { return ''; } };

function DailyLog({ people, cycle }) {
  const { isLead, isStakeholder } = useApp();
  const [personId, setPersonIdRaw] = useState(remembered);
  // Everyone shares one login, so this browser remembers whose log it was on.
  const setPersonId = (id) => {
    setPersonIdRaw(id);
    try { localStorage.setItem(PERSON_KEY, id); } catch { /* not remembered, still works */ }
  };
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');

  // Start on whoever this browser last chose, or the first person.
  useEffect(() => {
    if (!people.length || people.some((p) => String(p.id) === personId)) return;
    setPersonIdRaw(String(people[0].id));
  }, [people]);

  const load = () => personId && api.tasks(cycle, personId).then(setTasks).catch((e) => setError(e.message));
  useEffect(() => { setTasks(null); load(); }, [cycle, personId, people]);

  const canEdit = !isStakeholder && isLead;
  const person = people.find((p) => String(p.id) === personId);

  const days = useMemo(() => {
    const out = new Map();
    for (const t of tasks || []) {
      if (!out.has(t.task_date)) out.set(t.task_date, []);
      out.get(t.task_date).push(t);
    }
    return [...out.entries()];
  }, [tasks]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <Alert onDismiss={() => setError('')}>{error}</Alert>}

      <div className="row">
        <label className="small muted nowrap" htmlFor="person">Person</label>
        <select id="person" value={personId} style={{ width: 'auto', minWidth: 220 }}
          onChange={(e) => setPersonId(e.target.value)}>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.team_name ? ` · ${p.team_name}` : ''}
            </option>
          ))}
        </select>
        {tasks && (
          <span className="faint small">
            {tasks.length} task{tasks.length === 1 ? '' : 's'} over {days.length} day{days.length === 1 ? '' : 's'}
            {tasks.length > 0 && ` · ${doneCount(tasks)} done`}
          </span>
        )}
      </div>

      {canEdit && personId && (
        <NewTask key={`${personId}:${cycle}`} cycle={cycle} personId={Number(personId)}
          onAdded={load} onError={setError} />
      )}

      {!tasks ? <div className="muted">Loading…</div> : days.length === 0 ? (
        <div className="card">
          <Empty title={`No tasks logged for ${person?.name || 'this person'} in ${fmtMonth(cycle)}`}
            hint={canEdit ? 'Add what was worked on above — a URL, a description, or both.' : undefined} />
        </div>
      ) : days.map(([day, list]) => (
        <div className="card" key={day}>
          <header>
            <h3>{fmtDay(day)}</h3>
            <div className="spacer" />
            <span className={`badge ${doneCount(list) === list.length ? 'green' : 'amber'}`}>
              {doneCount(list)} of {list.length} done
            </span>
          </header>
          <div className="body tasklist">
            {list.map((t) => (
              <TaskItem key={t.id} task={t} cycle={cycle} canEdit={canEdit} onChanged={load} onError={setError} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewTask({ cycle, personId, onAdded, onError }) {
  const t = today();
  const first = `${cycle}-01`;
  const last = lastDay(cycle);
  const [form, setForm] = useState({ task_date: t >= first && t <= last ? t : first, url: '', description: '', status: 'in_progress' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.url.trim() && !form.description.trim()) { onError('Add a URL or a description'); return; }
    setBusy(true); onError('');
    try {
      if (files.some((f) => f.size > MAX_FILE)) throw new Error('Each file must be 10 MB or less');
      const created = await api.createTask({ ...form, user_id: personId });
      try { await uploadAll(created.id, files); }
      catch (err) { onError(`Task saved, but a file did not upload: ${err.message}`); }
      setForm({ ...form, url: '', description: '', status: 'in_progress' });
      setFiles([]);
      onAdded();
    } catch (err) { onError(err.message); } finally { setBusy(false); }
  };

  return (
    <form className="card" onSubmit={submit}>
      <header><h3>Add a task</h3></header>
      <div className="body">
        <div className="taskform">
          <Field label="Date">
            <input type="date" required min={first} max={last} value={form.task_date}
              onChange={(e) => setForm({ ...form, task_date: e.target.value })} />
          </Field>
          <Field label="URL">
            <input placeholder="https://www.cloudfuze.com/…" value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </Field>
          <StatusField value={form.status} onChange={(status) => setForm({ ...form, status })} />
        </div>
        <Field label="Description">
          <textarea placeholder="What was done — published, updated, designed, sent…" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Attachments" hint={FILE_HINT}>
          <div className="row">
            <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>📎 Choose files</button>
            {files.map((f, i) => (
              <span className="badge grey" key={i}>
                {f.name}
                <button type="button" className="linkish" title="Remove"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
          <input ref={fileRef} type="file" multiple hidden
            onChange={(e) => { setFiles([...files, ...e.target.files]); e.target.value = ''; }} />
        </Field>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Add task'}</button>
      </div>
    </form>
  );
}

function TaskItem({ task, cycle, canEdit, onChanged, onError }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(task);
  const [showFiles, setShowFiles] = useState(false);

  const save = async () => {
    try {
      await api.updateTask(task.id,
        { task_date: form.task_date, url: form.url, description: form.description, status: form.status });
      setEditing(false);
      onChanged();
    } catch (e) { onError(e.message); }
  };

  const toggleStatus = async () => {
    try {
      await api.updateTask(task.id, { status: task.status === 'done' ? 'in_progress' : 'done' });
      onChanged();
    } catch (e) { onError(e.message); }
  };

  const remove = async () => {
    if (!window.confirm('Delete this task and its attachments?')) return;
    try { await api.deleteTask(task.id); onChanged(); } catch (e) { onError(e.message); }
  };

  if (editing) {
    return (
      <div className="taskitem">
        <div className="taskform">
          <Field label="Date">
            <input type="date" min={`${cycle}-01`} max={lastDay(cycle)} value={form.task_date}
              onChange={(e) => setForm({ ...form, task_date: e.target.value })} />
          </Field>
          <Field label="URL">
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </Field>
          <StatusField value={form.status} onChange={(status) => setForm({ ...form, status })} />
        </div>
        <Field label="Description">
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="row">
          <button className="btn primary sm" onClick={save}>Save</button>
          <button className="btn sm" onClick={() => { setForm(task); setEditing(false); }}>Cancel</button>
        </div>
      </div>
    );
  }

  const n = task.attachments.length;
  return (
    <div className="taskitem">
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {task.url && (
            <a className="taskurl" href={task.url} target="_blank" rel="noreferrer" title={task.url}>
              🔗 {shortUrl(task.url)}
            </a>
          )}
          {task.description && <div className="taskdesc">{task.description}</div>}
        </div>
        {canEdit ? (
          <button className={`btn sm status ${task.status}`} onClick={toggleStatus}
            title={task.status === 'done' ? 'Mark as in progress' : 'Mark as done'}>
            {task.status === 'done' ? '✓ Done' : '◷ In progress'}
          </button>
        ) : (
          <span className={`badge ${task.status === 'done' ? 'green' : 'amber'}`}>{STATUS_LABEL[task.status]}</span>
        )}
        <button className="btn sm" onClick={() => setShowFiles(!showFiles)}>
          📎 {n || (canEdit ? 'Attach' : 0)}
        </button>
        {canEdit && <button className="btn sm" onClick={() => setEditing(true)}>Edit</button>}
        {canEdit && <button className="btn sm danger" onClick={remove}>Delete</button>}
      </div>
      {showFiles && (
        <div style={{ marginTop: 10 }}>
          <Attachments
            items={task.attachments} canEdit={canEdit} api={api} downloadWithAuth={downloadWithAuth}
            hint={FILE_HINT}
            onUpload={async (files) => { await uploadAll(task.id, files); onChanged(); }}
            onDelete={async (id) => {
              try { await api.deleteAttachment(id); onChanged(); } catch (e) { onError(e.message); }
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------ monthly summary */

function Summary({ people, cycle }) {
  const { refreshKey } = useApp();
  const [tasks, setTasks] = useState(null);
  const [teamId, setTeamId] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    setTasks(null);
    api.tasks(cycle).then(setTasks).catch((e) => setError(e.message));
  }, [cycle, refreshKey]);

  const teams = useMemo(() => {
    const seen = new Map();
    for (const p of people) if (p.team_id) seen.set(p.team_id, p.team_name);
    return [...seen.entries()];
  }, [people]);

  // Every person, including those who logged nothing — a blank is worth seeing.
  const rows = useMemo(() => {
    if (!tasks) return [];
    return people
      .filter((p) => !teamId || String(p.team_id) === teamId)
      .map((p) => {
        const mine = tasks.filter((t) => t.user_id === p.id)
          .sort((a, b) => a.task_date.localeCompare(b.task_date) || a.id - b.id);
        return {
          ...p,
          tasks: mine,
          days: new Set(mine.map((t) => t.task_date)).size,
          done: doneCount(mine),
          urls: mine.filter((t) => t.url).length,
          files: mine.reduce((n, t) => n + t.attachments.length, 0),
          last: mine.length ? mine[mine.length - 1].task_date : null,
        };
      })
      .sort((a, b) => b.tasks.length - a.tasks.length || a.name.localeCompare(b.name));
  }, [people, tasks, teamId]);

  if (error) return <Alert onDismiss={() => setError('')}>{error}</Alert>;
  if (!tasks) return <div className="muted">Loading…</div>;

  const total = (k) => rows.reduce((n, r) => n + (k === 'tasks' ? r.tasks.length : r[k]), 0);
  const logged = rows.filter((r) => r.tasks.length).length;
  const toggle = (id) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOpen(next);
  };
  const allOpen = rows.length > 0 && rows.every((r) => !r.tasks.length || open.has(r.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="tiles">
        <div className="tile"><div className="v">{logged}<span className="faint" style={{ fontSize: 18 }}> / {rows.length}</span></div>
          <div className="l">People who logged work</div></div>
        <div className="tile"><div className="v">{total('tasks')}</div><div className="l">Tasks</div></div>
        <div className="tile"><div className="v">{total('done')}<span className="faint" style={{ fontSize: 18 }}> / {total('tasks')}</span></div>
          <div className="l">Tasks done</div></div>
        <div className="tile"><div className="v">{total('urls')}</div><div className="l">URLs</div></div>
        <div className="tile"><div className="v">{total('files')}</div><div className="l">Attachments</div></div>
      </div>

      <div className="row no-print">
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ width: 'auto', minWidth: 180 }}>
          <option value="">All teams</option>
          {teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <button className="btn sm" onClick={() => setOpen(allOpen ? new Set() : new Set(rows.map((r) => r.id)))}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn sm" title="Every task this month, one line each"
          onClick={() => downloadWithAuth(api.exportUrl('tasks', cycle), `daily-tasks-${cycle}.csv`)}>
          ⬇ Export
        </button>
        <button className="btn primary sm" onClick={() => window.print()}>🖨 Print / Save as PDF</button>
      </div>

      <div className="card">
        <header><h3>{fmtMonth(cycle)} — work per person</h3></header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th><th className="nowrap">Days logged</th><th className="nowrap">Tasks</th>
                <th className="nowrap">Done</th>                <th className="nowrap">URLs</th><th className="nowrap">Attachments</th><th className="nowrap">Last entry</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className={r.tasks.length ? 'clickable' : undefined}
                    onClick={() => r.tasks.length && toggle(r.id)}>
                    <td>
                      <span className="row" style={{ gap: 7, flexWrap: 'nowrap' }}>
                        <span className="faint" style={{ width: 10 }}>{r.tasks.length ? (open.has(r.id) ? '▾' : '▸') : ''}</span>
                        <i className="dot" style={{ background: r.team_colour || '#94a3b8' }} />
                        <b>{r.name}</b>
                        <span className="faint small">{r.team_name}</span>
                      </span>
                    </td>
                    <td className="nowrap">{r.days || <span className="faint">—</span>}</td>
                    <td className="nowrap">{r.tasks.length
                      ? <b>{r.tasks.length}</b> : <span className="badge amber">Nothing logged</span>}</td>
                    <td className="nowrap">{r.tasks.length
                      ? `${r.done} of ${r.tasks.length}` : <span className="faint">—</span>}</td>
                    <td className="nowrap">{r.urls || <span className="faint">—</span>}</td>
                    <td className="nowrap">{r.files || <span className="faint">—</span>}</td>
                    <td className="nowrap small">{r.last ? fmtDay(r.last) : <span className="faint">—</span>}</td>
                  </tr>
                  {open.has(r.id) && (
                    <tr className="expanded">
                      <td colSpan={7}>
                        <table className="worklist">
                          <tbody>
                            {r.tasks.map((t) => (
                              <tr key={t.id}>
                                <td className="nowrap small muted" style={{ width: 110 }}>{fmtDay(t.task_date)}</td>
                                <td className="nowrap" style={{ width: 100 }}>
                                  <span className={`badge ${t.status === 'done' ? 'green' : 'amber'}`}>{STATUS_LABEL[t.status]}</span>
                                </td>
                                <td style={{ width: '34%' }}>
                                  {t.url
                                    ? <a href={t.url} target="_blank" rel="noreferrer" className="taskurl">{shortUrl(t.url)}</a>
                                    : <span className="faint">—</span>}
                                </td>
                                <td className="taskdesc">{t.description || <span className="faint">—</span>}</td>
                                <td className="nowrap small" style={{ textAlign: 'right' }}>
                                  {t.attachments.map((a) => (
                                    <button key={a.id} className="linkish" title={`Download ${a.original_name}`}
                                      onClick={() => downloadWithAuth(api.downloadUrl(a.id), a.original_name)}>
                                      📎 {a.original_name}
                                    </button>
                                  ))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
