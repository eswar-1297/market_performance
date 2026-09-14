import React, { useEffect, useRef, useState } from 'react';

export const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'In Review', 'Completed', 'Cancelled'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
export const TARGET_STATUSES = ['Not Started', 'On Track', 'At Risk', 'Off Track', 'Achieved'];

const STATUS_TONE = {
  'Not Started': 'grey', 'In Progress': 'blue', 'Blocked': 'red',
  'In Review': 'purple', 'Completed': 'green', 'Cancelled': 'grey',
  'On Track': 'green', 'At Risk': 'amber', 'Off Track': 'red', 'Achieved': 'green',
};
const PRIORITY_TONE = { Low: 'grey', Medium: 'blue', High: 'amber', Critical: 'red' };

export const Badge = ({ tone = 'grey', children }) => <span className={`badge ${tone}`}>{children}</span>;
export const StatusBadge = ({ value }) => <Badge tone={STATUS_TONE[value] || 'grey'}>{value}</Badge>;
export const PriorityBadge = ({ value }) => <Badge tone={PRIORITY_TONE[value] || 'grey'}>{value}</Badge>;

export const Bar = ({ value, colour }) => (
  <div className="bar" title={`${value}%`}>
    <i style={{ width: `${Math.max(0, Math.min(100, value || 0))}%`, background: colour || undefined }} />
  </div>
);

export function Kpi({ label, value, note, tone }) {
  const colour = { green: 'var(--green)', red: 'var(--red)', amber: 'var(--amber)' }[tone];
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value" style={colour ? { color: colour } : undefined}>{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

export const Empty = ({ title, hint }) => (
  <div className="empty"><b>{title}</b>{hint}</div>
);

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(860px, 100%)' } : undefined}>
        <header><h2>{title}</h2><button className="icon-btn" onClick={onClose}>×</button></header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({ title, subtitle, onClose, children, actions }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <header>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{title}</h2>
            {subtitle && <div className="small muted" style={{ marginTop: 3 }}>{subtitle}</div>}
          </div>
          {actions}
          <button className="icon-btn" onClick={onClose}>×</button>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function Alert({ kind = 'error', children, onDismiss }) {
  if (!children) return null;
  return (
    <div className={`alert ${kind}`} onClick={onDismiss} style={onDismiss ? { cursor: 'pointer' } : undefined}>
      {children}
    </div>
  );
}

/** Shared file + link attachment panel, used by tasks and targets. */
export function Attachments({ items = [], onUpload, onLink, onDelete, canEdit, api, downloadWithAuth }) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState({ url: '', label: '' });
  const inputRef = useRef(null);

  const send = async (files) => {
    if (!files?.length) return;
    setBusy(true); setErr('');
    try { await onUpload(files); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {err && <Alert onDismiss={() => setErr('')}>{err}</Alert>}

      {items.length === 0 && !canEdit && <div className="small faint">No attachments.</div>}

      {items.map((a) => (
        <div className="attach" key={a.id}>
          <span>{a.kind === 'link' ? '🔗' : '📎'}</span>
          <span className="name" title={a.original_name || a.url}>
            {a.kind === 'link'
              ? <a href={a.url} target="_blank" rel="noreferrer">{a.label || a.url}</a>
              : a.original_name}
            <span className="faint small">
              {' '}· {a.uploaded_by_name || 'Unknown'}
              {a.kind === 'file' && a.size_bytes ? ` · ${fmtSize(a.size_bytes)}` : ''}
            </span>
          </span>
          {a.kind === 'file' && (
            <button className="btn sm" onClick={() => downloadWithAuth(api.downloadUrl(a.id), a.original_name)}>
              Download
            </button>
          )}
          {canEdit && <button className="btn sm danger" onClick={() => onDelete(a.id)}>Remove</button>}
        </div>
      ))}

      {canEdit && (
        <>
          <div
            className={`dropzone${over ? ' over' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
          >
            {busy ? 'Uploading…' : 'Drop files here, or click to choose'}
            <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
              Images, PDF, Word, Excel, PowerPoint, CSV, ZIP · up to 25 MB each
            </div>
          </div>
          <input
            ref={inputRef} type="file" multiple hidden
            onChange={(e) => { send(e.target.files); e.target.value = ''; }}
          />

          {linkOpen ? (
            <div className="card" style={{ padding: 12 }}>
              <Field label="Link (Search Console, Looker Studio, Figma, Drive…)">
                <input placeholder="https://…" value={link.url}
                  onChange={(e) => setLink({ ...link, url: e.target.value })} />
              </Field>
              <Field label="Label (optional)">
                <input value={link.label} onChange={(e) => setLink({ ...link, label: e.target.value })} />
              </Field>
              <div className="row">
                <button className="btn primary sm" onClick={async () => {
                  setErr('');
                  try { await onLink(link); setLink({ url: '', label: '' }); setLinkOpen(false); }
                  catch (e) { setErr(e.message); }
                }}>Add link</button>
                <button className="btn sm" onClick={() => setLinkOpen(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn sm" onClick={() => setLinkOpen(true)} style={{ alignSelf: 'flex-start' }}>
              🔗 Add a link instead
            </button>
          )}
        </>
      )}
    </div>
  );
}

export const fmtDate = (d) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—';

export const fmtDateTime = (d) =>
  d ? new Date(d.includes('T') ? d : `${d.replace(' ', 'T')}Z`).toLocaleString(undefined,
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export const fmtMonth = (c) =>
  c ? new Date(`${c}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';

/** 2.5 -> "2.5%", 537 -> "$537", 111 -> "111 keywords" */
export const fmtMetric = (v, unit) => {
  if (v == null) return '—';
  const n = Number(v);
  const s = Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (unit === '%') return `${s}%`;
  if (unit === '$') return `$${s}`;
  return unit ? `${s} ${unit}` : s;
};
