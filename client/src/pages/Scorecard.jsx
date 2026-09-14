import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Alert, Empty, Field, Modal } from '../components/ui.jsx';

/**
 * The monthly sheet: one table per team, a row per person, and a Target /
 * Achieved pair under every column that team is measured on. Cells are plain
 * text boxes that save the moment you click away — the team fills them in by
 * hand, the same way they do in the spreadsheet this replaces.
 */
export default function Scorecard({ teams, allTeams, cycle, isLead, isStakeholder, onSaved, readOnly }) {
  const shown = teams.filter((t) => t.rows.length > 0 || t.fields.length > 0);

  // Everyone on any sheet, so a person can be put on a second team's sheet too.
  const everyone = [];
  for (const t of (allTeams || teams)) {
    for (const row of t.rows) {
      if (!everyone.some((p) => p.user_id === row.user_id)) {
        everyone.push({ user_id: row.user_id, name: row.name });
      }
    }
  }

  if (!shown.length) {
    return (
      <div className="card">
        <Empty title="Nothing to fill in yet"
          hint="Add people under Members, then give each team its columns." />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {shown.map((team) => (
        <TeamGrid key={team.id} team={team} cycle={cycle} readOnly={readOnly} everyone={everyone}
          isLead={isLead} isStakeholder={isStakeholder} onSaved={onSaved} />
      ))}
    </div>
  );
}

/**
 * One quiet ⋯ per column. Clicking it opens the three things you can do to that
 * column. The menu is positioned in the page rather than inside the table, so a
 * sheet that scrolls sideways never clips it.
 */
function ColMenu({ what, onAdd, onEdit, onDelete }) {
  const [at, setAt] = useState(null);
  const btn = useRef(null);

  useEffect(() => {
    if (!at) return undefined;
    const close = () => setAt(null);
    const esc = (e) => e.key === 'Escape' && setAt(null);
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', esc);
    };
  }, [at]);

  const open = (e) => {
    e.stopPropagation();
    const r = btn.current.getBoundingClientRect();
    setAt({ top: r.bottom + 5, left: Math.max(8, Math.min(r.right - 190, window.innerWidth - 198)) });
  };

  const pick = (fn) => (e) => { e.stopPropagation(); setAt(null); fn(); };

  return (
    <>
      <button ref={btn} className="colbtn" onClick={open}
        title={`Change ${what}`} aria-label={`Change ${what}`}>⋯</button>
      {at && (
        <div className="colmenu" style={{ top: at.top, left: at.left }} onClick={(e) => e.stopPropagation()}>
          <div className="head">{what}</div>
          <button onClick={pick(onAdd)}>＋&nbsp;&nbsp;Add a sub-column</button>
          <button onClick={pick(onEdit)}>✎&nbsp;&nbsp;Rename / edit</button>
          <button className="danger" onClick={pick(onDelete)}>✕&nbsp;&nbsp;Delete</button>
        </div>
      )}
    </>
  );
}

const Lower = () => (
  <span className="faint" title="Lower is better — the review scores it that way"
    style={{ fontSize: 11, marginLeft: 4 }}>↓ lower</span>
);

function TeamGrid({ team, cycle, isLead, isStakeholder, onSaved, readOnly, everyone = [] }) {
  const [values, setValues] = useState({});
  const [flash, setFlash] = useState({});
  const [adding, setAdding] = useState(null);   // { under } — null while closed
  const [editing, setEditing] = useState(null); // a heading, or a plain column
  const [error, setError] = useState('');

  // A person can have several rows, so a box is addressed by its row, not by
  // the person. A row that has never been written yet has no id of its own.
  const rowKey = (row) => (row.row_id ? `r${row.row_id}` : `u${row.user_id}`);
  const key = (row, fieldId) => `${rowKey(row)}:${fieldId}`;

  // Reload the grid from the server whenever the month or the data changes.
  useEffect(() => {
    const next = {};
    for (const row of team.rows) {
      for (const [fieldId, v] of Object.entries(row.values)) {
        next[key(row, fieldId)] = { ...v };
      }
    }
    setValues(next);
  }, [team, cycle]);

  const edit = (row, fieldId, which) => (e) => {
    const k = key(row, fieldId);
    setValues((s) => ({ ...s, [k]: { ...s[k], [which]: e.target.value } }));
  };

  const commit = (row, fieldId) => async () => {
    const k = key(row, fieldId);
    const cell = values[k] || { target: '', achieved: '' };
    const original = row.values[fieldId] || { target: '', achieved: '' };
    if (cell.target === original.target && cell.achieved === original.achieved) return;
    try {
      await api.saveCell({
        cycle, row_id: row.row_id, user_id: row.user_id, field_id: Number(fieldId), ...cell,
      });
      setFlash((s) => ({ ...s, [k]: 'ok' }));
      setTimeout(() => setFlash((s) => ({ ...s, [k]: undefined })), 1400);
      onSaved?.();
    } catch (e) {
      setError(e.message);
      setFlash((s) => ({ ...s, [k]: 'bad' }));
    }
  };

  /** Another blank line under the same name — nothing to name or label. */
  const addRow = async (row) => {
    if (!window.confirm(`Add another row for ${row.name}?`)) return;
    try { await api.addRow({ user_id: row.user_id }); onSaved?.(); }
    catch (e) { setError(e.message); }
  };

  /** Put somebody on this team's sheet as well — Rahul under PPC and SEO/GEO. */
  const addPerson = async (e) => {
    const user_id = e.target.value;
    e.target.value = '';
    if (!user_id) return;
    const who = everyone.find((p) => String(p.user_id) === String(user_id));
    if (!window.confirm(`Add ${who?.name || 'this person'} to the ${team.name} sheet?`)) return;
    try { await api.addRow({ user_id: Number(user_id), team_id: team.id }); onSaved?.(); }
    catch (err) { setError(err.message); }
  };

  const removeRow = async (row) => {
    if (!window.confirm(
      `Remove this row for ${row.name}?\n\nWhatever was filled in on it, in every month, is deleted.`)) return;
    try { await api.deleteRow(row.row_id); onSaved?.(); }
    catch (e) { setError(e.message); }
  };

  // Columns that share a heading ("Newsletter") sit under it, side by side.
  const headings = [];
  for (const f of team.fields) {
    const home = f.group_name && headings.find((h) => h.group === f.group_name);
    if (home) home.fields.push(f);
    else headings.push({ key: `${f.group_name}:${f.id}`, group: f.group_name || '', fields: [f] });
  }
  // Sub-columns are drawn under their heading, so the body follows that order.
  const columns = headings.flatMap((h) => h.fields);

  const canAddColumns = isLead && !readOnly;
  const onSheet = new Set(team.rows.map((x) => x.user_id));
  const missing = everyone.filter((p) => !onSheet.has(p.user_id));

  return (
    <div className="card">
      <header style={{ flexWrap: 'wrap' }}>
        <i className="dot" style={{ background: team.colour }} />
        <h3>{team.name}</h3>
        <span className="faint small">
          {team.people} {team.people === 1 ? 'person' : 'people'}
          {team.rows.length !== team.people && <> · {team.rows.length} rows</>}
          {team.total_cells > 0 && <> · {team.filled_cells} of {team.total_cells} filled</>}
        </span>
        <div className="spacer" />
        {isLead && !readOnly && missing.length > 0 && (
          <select className="addperson" defaultValue="" onChange={addPerson} title="Put someone on this sheet too">
            <option value="">+ Add person…</option>
            {missing.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </select>
        )}
        {isLead && !readOnly && (
          <button className="btn sm" onClick={() => setAdding({ under: null })}>+ Add column</button>
        )}
      </header>

      {error && <div className="body" style={{ paddingBottom: 0 }}>
        <Alert onDismiss={() => setError('')}>{error}</Alert></div>}

      {editing && (
        <EditColumnModal
          team={team}
          heading={editing}
          onClose={() => setEditing(null)}
          onDone={(opts) => { if (!opts?.keepOpen) setEditing(null); onSaved?.(); }}
        />
      )}

      {adding && (
        <ColumnModal
          team={team}
          under={adding.under}
          onClose={() => setAdding(null)}
          onAdded={() => { setAdding(null); onSaved?.(); }}
        />
      )}

      {team.fields.length === 0 ? (
        <Empty title="No columns yet"
          hint={isLead ? 'Use “Add column” to set what this team is measured on.'
            : 'The marketing lead has not set this team columns yet.'} />
      ) : team.rows.length === 0 ? (
        <Empty title="Nobody in this team yet" hint="Add people under Members." />
      ) : (
        <div className="table-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th rowSpan={3} className="rowhead">Name</th>
                {headings.map((h) => (
                  h.group
                    ? <th key={h.key} colSpan={2 * h.fields.length} className="fieldhead grouphead">
                        {h.group}
                        {canAddColumns && (
                          <ColMenu what={h.group}
                            onAdd={() => setAdding({ under: h.fields[0] })}
                            onEdit={() => setEditing(h)}
                            onDelete={() => setEditing({ ...h, straightToDelete: true })} />
                        )}
                      </th>
                    : <th key={h.key} colSpan={2} rowSpan={2} className="fieldhead">
                        <span>{h.fields[0].name}</span>
                        {h.fields[0].direction === 'down' && <Lower />}
                        {canAddColumns && (
                          <ColMenu what={h.fields[0].name}
                            onAdd={() => setAdding({ under: h.fields[0] })}
                            onEdit={() => setEditing(h)}
                            onDelete={() => setEditing({ ...h, straightToDelete: true })} />
                        )}
                      </th>
                ))}
              </tr>
              <tr>
                {headings.filter((h) => h.group).flatMap((h) => h.fields.map((f) => (
                  <th key={f.id} colSpan={2} className="fieldhead subhead">
                    <span>{f.name}</span>
                    {f.direction === 'down' && <Lower />}
                  </th>
                )))}
              </tr>
              <tr>
                {columns.map((f) => (
                  <React.Fragment key={f.id}>
                    <th className="sub">Target</th>
                    <th className="sub">Achieved</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.rows.map((row, i) => {
                const first = i === 0 || team.rows[i - 1].user_id !== row.user_id;
                const last = i === team.rows.length - 1 || team.rows[i + 1].user_id !== row.user_id;
                const canChange = !readOnly && !isStakeholder && row.can_edit;
                return (
                <tr key={rowKey(row)} className={first ? 'person-start' : undefined}>
                  <th className="rowhead">
                    <div className="rowname">
                      <div style={{ minWidth: 0 }}>
                        {first ? (
                          <>
                            <div style={{ fontWeight: 600 }}>{row.name}</div>
                            <div className="faint small">{row.designation}</div>
                          </>
                        ) : (
                          <div className="faint small">{row.name}</div>
                        )}
                      </div>
                      {canChange && (
                        <span className="rowtools">
                          {last && (
                            <button title={`Add another row for ${row.name}`}
                              onClick={() => addRow(row)}>＋</button>
                          )}
                          {!first && (
                            <button title="Remove this row" onClick={() => removeRow(row)}>×</button>
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                  {columns.map((f) => {
                    const k = key(row, f.id);
                    const cell = values[k] || { target: '', achieved: '' };
                    const locked = isStakeholder || !row.can_edit;
                    if (readOnly) {
                      return (
                        <React.Fragment key={f.id}>
                          <td className="cellbox"><div className="cellview">{cell.target || '—'}</div></td>
                          <td className="cellbox">
                            <div className="cellview done">{cell.achieved || '—'}</div>
                          </td>
                        </React.Fragment>
                      );
                    }
                    return (
                      <React.Fragment key={f.id}>
                        <td className="cellbox">
                          <input className={`cell${flash[k] ? ` ${flash[k]}` : ''}`}
                            value={cell.target} disabled={locked}
                            placeholder={locked ? '' : '—'}
                            onChange={edit(row, f.id, 'target')}
                            onBlur={commit(row, f.id)}
                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                        </td>
                        <td className="cellbox">
                          <input className={`cell done${flash[k] ? ` ${flash[k]}` : ''}`}
                            value={cell.achieved} disabled={locked}
                            placeholder={locked ? '' : '—'}
                            onChange={edit(row, f.id, 'achieved')}
                            onBlur={commit(row, f.id)}
                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * One box, one question: what is this column called. Opened from "+ Add column"
 * for a column of its own, or from the + on a column header for a sub-column
 * under it.
 */
function ColumnModal({ team, under, onClose, onAdded }) {
  const [name, setName] = useState('');
  const [lower, setLower] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const heading = under ? (under.group_name || under.name) : '';

  const save = async () => {
    setBusy(true); setError('');
    try {
      const body = { name: name.trim(), direction: lower ? 'down' : 'up' };
      if (under) await api.addSubField(under.id, body);
      else await api.addField({ team_id: team.id, ...body });
      onAdded();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal
      title={under ? `Add a sub-column under “${heading}”` : `Add a column to ${team.name}`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </>}
    >
      <Alert onDismiss={() => setError('')}>{error}</Alert>

      <Field
        label={under ? 'What does this sub-column measure?' : 'What does this column measure?'}
        hint={under
          ? `It gets its own Target and Achieved boxes under “${heading}”. Add as many as you need — one at a time.`
          : 'It gets its own Target and Achieved boxes, for everyone on this sheet.'}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
          placeholder={under ? 'open rate' : 'Leads'} />
      </Field>

      <Field>
        <label className="row small" style={{ gap: 7 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={lower}
            onChange={(e) => setLower(e.target.checked)} />
          Lower is better — like CPL, 404s or turnaround time
        </label>
      </Field>

      {under && !under.group_name && (
        <div className="small muted">
          “{under.name}” becomes a heading. Anything already filled in under it stays, as a
          sub-column called <b>total</b>.
        </div>
      )}
    </Modal>
  );
}

/**
 * Edit one column, or a heading and everything under it: rename the heading,
 * rename each sub-column, flip which way counts as good, drop the ones no longer
 * measured, or delete the lot. How many boxes a column holds is spelled out
 * before anything is removed.
 */
function EditColumnModal({ team, heading, onClose, onDone }) {
  const grouped = !!heading.group;
  const [groupName, setGroupName] = useState(heading.group);
  const [cols, setCols] = useState(heading.fields.map((f) => ({
    id: f.id, name: f.name, lower: f.direction === 'down',
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const filled = (id) => team.rows.reduce((n, row) => {
    const v = row.values[id];
    return n + (v && (v.target !== '' || v.achieved !== '') ? 1 : 0);
  }, 0);

  const setCol = (id, patch) => setCols((s) => s.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const dropColumn = async (col) => {
    const n = filled(col.id);
    const last = cols.length === 1;
    const warn = [`Delete the “${col.name}” column?`];
    if (n) warn.push(`${n} filled box(es) go with it, in every month.`);
    if (last && grouped) warn.push(`It is the last one under “${heading.group}”, so the heading goes too.`);
    if (!window.confirm(warn.join('\n\n'))) return;
    try {
      await api.deleteField(col.id);
      setCols((s) => s.filter((c) => c.id !== col.id));
      onDone(last ? undefined : { keepOpen: true });
    } catch (e) { setError(e.message); }
  };

  const dropAll = async () => {
    const n = heading.fields.reduce((sum, f) => sum + filled(f.id), 0);
    const warn = [grouped
      ? `Delete “${heading.group}” and its ${heading.fields.length} column(s)?`
      : `Delete the “${cols[0].name}” column?`];
    if (n) warn.push(`${n} filled box(es) go with ${grouped ? 'them' : 'it'}, in every month.`);
    if (!window.confirm(warn.join('\n\n'))) return;
    try {
      if (grouped) await api.deleteGroup({ team_id: team.id, name: heading.group });
      else await api.deleteField(cols[0].id);
      onDone();
    } catch (e) { setError(e.message); }
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      if (grouped && groupName.trim() && groupName.trim() !== heading.group) {
        await api.renameGroup({ team_id: team.id, from: heading.group, to: groupName.trim() });
      }
      for (const col of cols) {
        const was = heading.fields.find((f) => f.id === col.id);
        if (!was || !col.name.trim()) continue;
        if (col.name.trim() !== was.name || col.lower !== (was.direction === 'down')) {
          await api.renameField(col.id, { name: col.name.trim(), direction: col.lower ? 'down' : 'up' });
        }
      }
      onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  // Picking "Delete" from the menu asks the question straight away; cancelling
  // leaves the edit form open, which is where you would go next anyway.
  useEffect(() => { if (heading.straightToDelete) dropAll(); }, []);

  return (
    <Modal
      title={grouped ? `Edit “${heading.group}”` : `Edit “${heading.fields[0].name}”`}
      onClose={onClose}
      wide={grouped}
      footer={<>
        <button className="btn danger" onClick={dropAll}>
          {grouped ? 'Delete heading' : 'Delete column'}
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </>}
    >
      <Alert onDismiss={() => setError('')}>{error}</Alert>

      {grouped && (
        <Field label="Heading" hint="The name spanning the columns underneath.">
          <input value={groupName} onChange={(e) => setGroupName(e.target.value)} autoFocus />
        </Field>
      )}

      <div className="field">
        <label>{grouped ? 'Columns under it' : 'Column'}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cols.map((col) => (
            <div className="coledit" key={col.id}>
              <input value={col.name} autoFocus={!grouped}
                onChange={(e) => setCol(col.id, { name: e.target.value })} />
              <label className="row small nowrap" style={{ gap: 6 }} title="Lower is the better result">
                <input type="checkbox" style={{ width: 'auto' }} checked={col.lower}
                  onChange={(e) => setCol(col.id, { lower: e.target.checked })} />
                ↓ lower
              </label>
              <span className="faint small nowrap">
                {filled(col.id) ? `${filled(col.id)} filled` : 'empty'}
              </span>
              <button className="btn sm danger" onClick={() => dropColumn(col)}>Delete</button>
            </div>
          ))}
        </div>
        {grouped && <small>Use the ＋ on the heading to add another column under it.</small>}
      </div>
    </Modal>
  );
}
