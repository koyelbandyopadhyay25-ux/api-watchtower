import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api/client';
import type { MonitoringSchedule, ScheduledRun } from '../api/types';
import { Modal, Notice, StatusBadge, Timestamp } from './common';

type Settings = Pick<MonitoringSchedule, 'enabled' | 'intervalMinutes'>;
const same = (a: Settings, b: Settings) => a.enabled === b.enabled && a.intervalMinutes === b.intervalMinutes;

/** Configuration is persisted by the API; this component never schedules requests. */
export function MonitoringSettings({ id, revision = 0, blocked = false, supported = true, onSaved, onBusy }: {
  id: string; revision?: number; blocked?: boolean; supported?: boolean;
  onSaved?: () => void; onBusy?: (busy: boolean) => void;
}) {
  const [saved, setSaved] = useState<MonitoringSchedule | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [run, setRun] = useState<ScheduledRun | null>(null);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Settings | null>(null);
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  const mounted = useRef(true);
  const savedRef = useRef<MonitoringSchedule | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    void Promise.allSettled([api.schedule(id, controller.signal), api.scheduledHistory(id, controller.signal)]).then(([config, history]) => {
      if (controller.signal.aborted) return;
      if (config.status === 'fulfilled') {
        const value = config.value;
        if (!savedRef.current || !same(savedRef.current, value)) setDraft({ enabled: value.enabled, intervalMinutes: value.intervalMinutes });
        savedRef.current = value; setSaved(value);
      } else setError(errorMessage(config.reason));
      const validHistory = history.status === 'fulfilled' && Array.isArray(history.value.runs);
      setHistoryUnavailable(!validHistory);
      setRun(validHistory && history.status === 'fulfilled' ? history.value.runs[0] ?? null : null);
      setLoading(false);
    });
    return () => controller.abort();
  }, [id, revision, reload]);

  async function save(desired: Settings) {
    if (lock.current || !saved || blocked) return;
    lock.current = true; setSaving(true); onBusy?.(true); setError(null); setNotice(null);
    try {
      // Detect changes made since this form loaded. Never silently retry a conflict.
      // The API has no compare-and-swap version: a narrow last-writer race remains.
      const current = await api.schedule(id);
      if (!same(current, saved)) {
        if (mounted.current) {
          savedRef.current = current; setSaved(current); setDraft({ enabled: current.enabled, intervalMinutes: current.intervalMinutes });
          setNotice('Settings changed elsewhere. Review the refreshed configuration before saving again.');
        }
        return;
      }
      await api.configureSchedule(id, desired);
      const verified = await api.schedule(id);
      if (!mounted.current) return;
      savedRef.current = verified; setSaved(verified); setDraft({ enabled: verified.enabled, intervalMinutes: verified.intervalMinutes });
      setNotice(same(verified, desired) ? 'Monitoring settings saved.' : 'Settings changed concurrently. The current saved configuration is shown.');
      setReload(value => value + 1); onSaved?.();
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      lock.current = false;
      if (mounted.current) { setSaving(false); setConfirm(null); onBusy?.(false); }
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !saved || lock.current) return;
    if (draft.enabled && !saved.enabled) setConfirm({ ...draft });
    else void save(draft);
  }
  const disabled = loading || saving || blocked || Boolean(error) || !saved || !draft;
  return <section className="panel" aria-labelledby="monitoring-heading" aria-busy={loading || saving}>
    <div className="panel-heading"><h2 id="monitoring-heading">Monitoring settings</h2><button className="text-button" disabled={loading || saving || blocked} onClick={() => setReload(value => value + 1)}>Refresh settings</button></div>
    <div className="panel-content">
      <p className="small muted">Automatic checks require the monitoring worker to be running.</p>
      {loading && <p role="status">Loading saved monitoring settings…</p>}
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {saved && draft ? <>
        <p className="small" data-testid="saved-schedule">Saved configuration: {saved.enabled ? 'Enabled' : 'Disabled'} · Every {saved.intervalMinutes} minutes</p>
        <form className="monitoring-form" onSubmit={submit}>
          <label className="monitoring-checkbox"><input type="checkbox" checked={draft.enabled} disabled={disabled || (!supported && !saved.enabled)} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />Enable automatic monitoring</label>
          <label className="monitoring-frequency">Frequency<select value={draft.intervalMinutes} disabled={disabled} onChange={event => setDraft({ ...draft, intervalMinutes: Number(event.target.value) as Settings['intervalMinutes'] })}>{[5, 15, 30, 60].map(minutes => <option key={minutes} value={minutes}>Every {minutes} minutes</option>)}</select></label>
          <button className="button" type="submit" disabled={disabled || same(saved, draft) || (!supported && draft.enabled)}>{saving ? 'Saving settings…' : 'Save monitoring settings'}</button>
        </form>
        <dl className="schedule-summary"><div><dt>Next scheduled check (UTC)</dt><dd><Timestamp value={saved.nextRunAt} /></dd></div>
          <div><dt>Last scheduled check (UTC)</dt><dd><Timestamp value={run?.checkResult.checkedAt ?? saved.lastStartedAt} /></dd></div>
          <div><dt>Last scheduled result</dt><dd>{historyUnavailable ? 'Unavailable' : run ? <StatusBadge check={run.checkResult} /> : 'No scheduled result saved'}</dd></div></dl>
      </> : !loading && <p>Monitoring settings unavailable. Refresh settings to retry.</p>}
      {historyUnavailable && <p className="small muted">Scheduled history could not be loaded. Refresh settings to retry.</p>}
    </div>
    <div className="panel-footer">Settings persist in PostgreSQL. Disabling preserves history. Refresh to load new worker results; an enabled schedule does not confirm a running worker.</div>
    {confirm && <Modal title="Enable automatic monitoring?" busy={saving} onClose={() => { if (!saving) setConfirm(null); }}><div className="modal-body"><p>The first check becomes due immediately, then every {confirm.intervalMinutes} minutes while the worker is running. Your baseline will not be replaced.</p><div className="actions form-actions"><button className="button" disabled={saving} onClick={() => setConfirm(null)}>Cancel</button><button className="button button-primary" disabled={saving} onClick={() => void save(confirm)}>Confirm enablement</button></div></div></Modal>}
  </section>;
}
