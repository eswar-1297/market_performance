import React, { useEffect, useState } from 'react';
import { api, downloadWithAuth } from '../api.js';
import { useApp } from '../App.jsx';
import { Alert, Badge, Bar, Empty, fmtMonth } from '../components/ui.jsx';

const tone = (pct) => (pct == null ? 'grey' : pct >= 100 ? 'green' : pct >= 70 ? 'amber' : 'red');
const colour = (pct) => ({
  green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)', grey: 'var(--faint)',
}[tone(pct)]);

/**
 * The month judged, not repeated: what share of targets was hit, which teams are
 * behind, and exactly who missed what. Built from the sheet, so nothing is typed
 * twice. Print / Save as PDF drops the navigation for a handout.
 */
export default function Review() {
  const { cycle, cycles, setCycle, refreshKey } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    api.review(cycle).then(setData).catch((e) => setError(e.message));
  }, [cycle, refreshKey]);

  if (error) return <Alert onDismiss={() => setError('')}>{error}</Alert>;
  if (!data) return <div className="muted">Loading…</div>;

  const o = data.overall;
  const behind = [...data.teams].filter((t) => t.people > 0)
    .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
  const missedBy = data.members.filter((m) => m.misses.length > 0)
    .sort((a, b) => b.misses.length - a.misses.length || (a.pct ?? 101) - (b.pct ?? 101));
  const clean = data.members.filter((m) => m.misses.length === 0 && m.met > 0);
  const silent = data.members.filter((m) => m.met === 0 && m.missed === 0 && m.not_reported === 0);
  const others = cycles.filter((c) => c !== cycle);

  if (o.scored === 0 && o.not_reported === 0) {
    return (
      <div className="card">
        <Empty title={`Nothing to review for ${fmtMonth(cycle)} yet`}
          hint="Once targets and results are typed into the monthly sheet, this page scores them." />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="body" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: 20 }}>{fmtMonth(cycle)} review</h2>
            <div className="muted small" style={{ marginTop: 3 }}>
              {o.people} people across {o.teams} teams · {o.scored} targets scored
              {o.not_reported > 0 && <> · {o.not_reported} with no result reported</>}
              {o.unclear > 0 && <> · {o.unclear} not comparable</>}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn sm no-print"
            onClick={() => downloadWithAuth(api.exportUrl('scorecard', cycle), `review-${cycle}.csv`)}>
            ⬇ Export sheet
          </button>
          <button className="btn primary sm no-print" onClick={() => window.print()}>
            🖨 Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="v" style={{ color: colour(o.pct) }}>{o.pct == null ? '—' : `${o.pct}%`}</div>
          <div className="l">Targets achieved{o.scored ? ` (${o.met} of ${o.scored})` : ''}</div>
        </div>
        <div className="tile">
          <div className="v" style={{ color: o.missed ? 'var(--red)' : 'var(--green)' }}>{o.missed}</div>
          <div className="l">Targets missed</div>
        </div>
        <div className="tile">
          <div className="v" style={{ color: o.people_missed ? 'var(--red)' : 'var(--green)' }}>
            {o.people_missed}
          </div>
          <div className="l">People who fell short</div>
        </div>
        <div className="tile">
          <div className="v" style={{ color: o.not_reported ? 'var(--amber)' : 'var(--green)' }}>
            {o.not_reported}
          </div>
          <div className="l">Targets with nothing reported</div>
        </div>
      </div>

      {/* ------------------------------------------------------- by team */}
      <div className="card">
        <header><h3>Teams — worst first</h3><div className="spacer" />
          <span className="faint small">{o.teams_behind} of {o.teams} teams have something outstanding</span>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Team</th><th className="nowrap">People</th><th className="nowrap">Achieved</th>
                <th className="nowrap">Missed</th><th className="nowrap">Not reported</th>
                <th style={{ width: 150 }}>Hit rate</th>
              </tr>
            </thead>
            <tbody>
              {behind.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className="row" style={{ gap: 7 }}>
                      <i className="dot" style={{ background: t.colour }} />
                      <b>{t.name}</b>
                    </span>
                  </td>
                  <td className="nowrap">{t.people}</td>
                  <td className="nowrap"><b>{t.met}</b><span className="faint"> / {t.scored}</span></td>
                  <td className="nowrap">{t.missed
                    ? <span className="badge red">{t.missed}</span> : <span className="faint">—</span>}</td>
                  <td className="nowrap">{t.not_reported
                    ? <span className="badge amber">{t.not_reported}</span> : <span className="faint">—</span>}</td>
                  <td>
                    <Bar value={t.pct ?? 0} colour={colour(t.pct)} />
                    <div className="small" style={{ marginTop: 3, color: colour(t.pct), fontWeight: 650 }}>
                      {t.pct == null ? 'nothing scored yet' : `${t.pct}%`}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --------------------------------------------------- who missed */}
      <div className="card">
        <header><h3>Who did not hit their targets</h3><div className="spacer" />
          <span className="faint small">{missedBy.length} {missedBy.length === 1 ? 'person' : 'people'}</span>
        </header>
        {missedBy.length === 0 ? (
          <Empty title="Everyone hit every target they were given" />
        ) : (
          <div className="body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {missedBy.map((m) => (
              <div className="missblock" key={m.user_id}>
                <div className="row" style={{ gap: 8 }}>
                  <i className="dot" style={{ background: m.colour }} />
                  <b>{m.name}</b>
                  <span className="faint small">{m.team}</span>
                  <div style={{ flex: 1 }} />
                  <Badge tone={tone(m.pct)}>
                    {m.pct == null ? 'nothing scored' : `${m.pct}% hit rate`}
                  </Badge>
                  <span className="faint small">{m.met} of {m.scored} met</span>
                </div>
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table>
                    <tbody>
                      {m.misses.map((x, i) => (
                        <tr key={i}>
                          <td style={{ width: '32%' }}>
                            <b>{x.group ? `${x.group} — ${x.field}` : x.field}</b>
                            {x.direction === 'down' && <span className="faint small"> (lower is better)</span>}
                          </td>
                          <td className="small">
                            target <b>{x.target || '—'}</b>
                            {x.verdict === 'not_reported'
                              ? <span style={{ color: 'var(--amber)' }}> · nothing reported</span>
                              : <> · actual <b>{x.achieved}</b></>}
                          </td>
                          <td className="nowrap" style={{ width: 120, textAlign: 'right' }}>
                            {x.verdict === 'not_reported'
                              ? <span className="badge amber">No result</span>
                              : <span className="badge red">
                                {x.pct == null ? 'Missed' : `${x.pct}% of target`}
                              </span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* -------------------------------------------------- hit it all */}
      {clean.length > 0 && (
        <div className="card">
          <header><h3>Hit everything they were given</h3><div className="spacer" />
            <span className="faint small">{clean.length} {clean.length === 1 ? 'person' : 'people'}</span>
          </header>
          <div className="body row" style={{ gap: 8 }}>
            {clean.map((m) => (
              <span className="badge green" key={m.user_id}>
                {m.name} · {m.met}/{m.scored}
              </span>
            ))}
          </div>
        </div>
      )}

      {silent.length > 0 && (
        <div className="card">
          <header><h3>No targets on the sheet at all</h3></header>
          <div className="body">
            <div className="row" style={{ gap: 8 }}>
              {silent.map((m) => (
                <span className="badge grey" key={m.user_id}>{m.name} · {m.team}</span>
              ))}
            </div>
            <div className="faint small" style={{ marginTop: 8 }}>
              Nothing was filled in for these people this month, so there is nothing to score.
            </div>
          </div>
        </div>
      )}

      {o.unclear > 0 && (
        <div className="card no-print">
          <div className="body small muted">
            {o.unclear} box{o.unclear === 1 ? '' : 'es'} could not be scored automatically — the
            target and the result are text that do not match (for example “ENT” against “SMB”).
            They are left out of the hit rate rather than counted as a miss.
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div className="card no-print">
          <header><h3>Other months on record</h3></header>
          <div className="body row">
            {others.map((c) => (
              <button key={c} className="btn sm" onClick={() => setCycle(c)}>{fmtMonth(c)}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
