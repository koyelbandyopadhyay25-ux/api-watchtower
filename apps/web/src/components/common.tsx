import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { CheckResult } from '../api/types';

export function StatusBadge({ check, unavailable = false }: { check: CheckResult | null; unavailable?: boolean }) {
  const state = unavailable ? ['Unavailable', 'neutral'] : !check ? ['Never checked', 'neutral']
    : check.outcome === 'success' ? ['Healthy', 'green']
      : check.outcome === 'schema_changed' ? ['Schema changed', 'amber'] : ['Failed', 'red'];
  return <span className={`badge badge-${state[1]}`}><span className="status-dot" aria-hidden="true" />{state[0]}</span>;
}

export function Timestamp({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="muted">—</span>;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <span className="muted">Unavailable</span>;
  return <time className="mono nowrap" dateTime={value} title={date.toISOString()}>{date.toISOString().slice(0, 19).replace('T', ' ')}</time>;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'warning' | 'success' }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} aria-modal="true" className="modal"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-heading"><h2 id={titleId}>{title}</h2><button type="button" className="text-button" onClick={onClose} disabled={busy} aria-label="Close dialog">Close</button></div>
    {children}
  </dialog>;
}
