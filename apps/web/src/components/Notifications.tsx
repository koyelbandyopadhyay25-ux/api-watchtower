import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api/client';
import type { NotificationSettings, NotificationEvent } from '../api/types';
import { Modal, Notice, Timestamp } from './common';

const eventLabels = { failure: 'Failure opened', recovery: 'Availability recovered', schema_changed: 'Schema changed', schema_restored: 'Sample matches baseline' };
const emailLabels = { pending: 'Queued', processing: 'Attempt in progress', smtp_accepted: 'SMTP accepted (Mailpit)', failed: 'Attempts failed', cancelled: 'Cancelled' };

export function Notifications({ id, revision = 0, blocked = false, onBusy }: { id: string; revision?: number; blocked?: boolean; onBusy?: (value: boolean) => void }) {
  const [saved, setSaved] = useState<NotificationSettings | null>(null);
  const previous = useRef<NotificationSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [reload, setReload] = useState(0);
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    void Promise.allSettled([api.notificationSettings(id, controller.signal), api.notifications(id, controller.signal)]).then(([settings, history]) => {
      if (controller.signal.aborted) return;
      if (settings.status === 'fulfilled') {
        if (!previous.current || previous.current.updatedAt !== settings.value.updatedAt) setEnabled(settings.value.enabled);
        previous.current = settings.value; setSaved(settings.value);
      } else setError(errorMessage(settings.reason));
      const valid = history.status === 'fulfilled' && Array.isArray(history.value.events);
      setHistoryError(!valid); setEvents(valid && history.status === 'fulfilled' ? history.value.events : []); setLoading(false);
    });
    return () => controller.abort();
  }, [id, revision, reload]);
  async function save() {
    if (lock.current || !saved || blocked) return;
    lock.current = true; setSaving(true); onBusy?.(true); setNotice(null); setError(null);
    try {
      await api.configureNotifications(id, enabled, saved.updatedAt);
      const verified = await api.notificationSettings(id);
      if (!mounted.current) return;
      setSaved(verified); previous.current = verified; setEnabled(verified.enabled);
      setNotice(verified.enabled === enabled ? 'Notification settings saved.' : 'Settings changed concurrently. The current saved state is shown.');
      setReload(value => value + 1);
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { lock.current = false; if (mounted.current) { setSaving(false); setConfirmation(false); onBusy?.(false); } }
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (!saved || lock.current) return;
    if (enabled && !saved.enabled) setConfirmation(true); else void save();
  }
  return <section className="panel" aria-labelledby="notification-heading" aria-busy={loading || saving}>
    <div className="panel-heading"><h2 id="notification-heading">Notifications and incidents</h2><button className="text-button" disabled={loading || saving || blocked} onClick={() => { setNotice(null); setReload(value => value + 1); }}>Refresh notifications</button></div>
    <div className="panel-content">
      <p className="small muted">Local Mailpit capture only; account email addresses are not used. Sending requires the separate email dispatcher. SMTP acceptance does not prove delivery to an inbox.</p>
      {loading && <p role="status">Loading notification settings and history…</p>}
      {error && <Notice tone="error">{error}</Notice>}{notice && <Notice>{notice}</Notice>}
      {saved ? <><p className="small" data-testid="saved-notifications">Saved notifications: {saved.enabled ? 'Enabled' : 'Disabled'}</p>
        <form className="monitoring-form" onSubmit={submit}><label className="monitoring-checkbox"><input type="checkbox" checked={enabled} disabled={loading || saving || blocked || Boolean(error)} onChange={event => setEnabled(event.target.checked)} />Enable local email notifications</label>
          <button className="button" disabled={loading || saving || blocked || Boolean(error) || enabled === saved.enabled}>{saving ? 'Saving notifications…' : 'Save notifications'}</button></form>
      </> : !loading && <p>Notification settings unavailable. Refresh to retry.</p>}
    </div>
    {historyError ? <div className="panel-content muted">Notification history unavailable. Other endpoint data remains usable.</div> : !loading && (events.length === 0 ? <div className="panel-content muted">No notification events recorded. Incidents are observed from new checks; old history is not replayed.</div> :
      <div className="table-scroll" role="region" aria-label="Notification history. Scroll horizontally for all columns." tabIndex={0}><table className="data-table notification-table"><caption className="sr-only">Persisted notification events, newest first</caption><thead><tr><th>Observed (UTC)</th><th>Event</th><th>HTTP / latency</th><th>Incident</th><th>Email</th><th>Attempts</th><th>Details</th></tr></thead><tbody>{events.map(event => <tr key={event.id}>
        <td><Timestamp value={event.createdAt} /></td><td>{eventLabels[event.kind]}</td><td className="mono">{event.checkResult.httpStatus ?? '—'} / {event.checkResult.responseTimeMs === null ? '—' : `${event.checkResult.responseTimeMs} ms`}</td>
        <td>{event.incident.closedAt ? 'Closed' : 'Open'}</td><td>{event.outbox ? emailLabels[event.outbox.state] : 'Not queued'}</td><td className="mono">{event.outbox?.attempts ?? 0}</td>
        <td><details><summary>View event</summary><p className="small">Opened <Timestamp value={event.incident.openedAt} />; closed <Timestamp value={event.incident.closedAt} /></p>
          <p className="mono small">{event.incident.resolution ?? 'Unresolved'} · {event.checkResult.errorCode ?? 'No check error'} · {event.outbox?.lastErrorCode ?? 'No delivery error'}</p>
          {event.checkResult.schemaChanges.slice(0, 20).map(change => <p className="mono small field-path" key={change.id}>{change.path}: {change.changeType} ({change.previousTypes.join(' | ') || 'absent'} → {change.currentTypes.join(' | ') || 'absent'})</p>)}
          {event.checkResult.schemaChanges.length > 20 && <p className="small muted">{event.checkResult.schemaChanges.length - 20} additional recorded differences. Inspect the check in monitoring history for its full comparison.</p>}
          {event.outbox?.deliveries.map(attempt => <p className="small" key={attempt.number}>Attempt {attempt.number}: {attempt.state} · <Timestamp value={attempt.startedAt} /> · {attempt.errorCode ?? 'No error recorded'}</p>)}
        </details></td></tr>)}</tbody></table></div>)}
    <div className="panel-footer">Up to 50 events. Only future transitions are queued after opt-in. Disabling cancels queued mail and preserves history; an already in-flight send may finish. Schema observations do not establish complete compatibility.</div>
    {confirmation && <Modal title="Enable local notifications?" busy={saving} onClose={() => { if (!saving) setConfirmation(false); }}><div className="modal-body"><p>Future failure, recovery and schema transitions may be captured in the shared local Mailpit inbox. No messages are sent to your account email, and historical events are not replayed.</p><div className="actions form-actions"><button className="button" disabled={saving} onClick={() => setConfirmation(false)}>Cancel</button><button className="button button-primary" disabled={saving} onClick={() => void save()}>Confirm notifications</button></div></div></Modal>}
  </section>;
}
