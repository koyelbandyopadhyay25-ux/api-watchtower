import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, supportedUrl } from '../api/client';
import type { CheckResponse, Endpoint } from '../api/types';
import { useEndpointDetail } from '../hooks/useEndpointDetail';
import { BaselineConfirmation } from './BaselineConfirmation';
import { CheckHistory, SchemaChanges } from './CheckHistory';
import { Notice, StatusBadge, Timestamp } from './common';

export function EndpointDetail({ id }: { id: string }) {
  const { data, loading, error, refresh } = useEndpointDetail(id);
  const [busy, setBusy] = useState<'check' | 'baseline' | null>(null);
  const [confirmation, setConfirmation] = useState<Endpoint | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'warning' | 'error' } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function run(kind: 'check' | 'baseline') {
    if (busy || !data || (kind === 'baseline' && !confirmation)) return;
    setBusy(kind); setNotice(null);
    try {
      const result: CheckResponse = kind === 'baseline' ? await api.acceptBaseline(id, confirmation!.updatedAt) : await api.check(id);
      if (!mounted.current) return;
      setSelectedId(result.check.id);
      const failed = !['success', 'schema_changed'].includes(result.check.outcome);
      setNotice({ tone: failed || result.check.outcome === 'schema_changed' ? 'warning' : 'success',
        text: kind === 'baseline' ? 'Baseline accepted from a fresh response. The capture check is saved in history.'
          : failed ? `Check saved as failed: ${result.check.errorCode ?? result.check.outcome}. Review the actual result below.`
            : result.comparison === 'baseline_missing' ? 'Check saved. No baseline has been accepted, so no schema comparison was made.'
              : result.check.schemaChanges.length > 0 ? `Check saved with ${result.check.schemaChanges.length} structural changes. The baseline was not replaced.`
                : 'Check saved. No structural changes were detected for this sample.' });
    } catch (failure) {
      if (mounted.current) setNotice({ tone: 'error', text: errorMessage(failure) });
    } finally {
      if (mounted.current) { setBusy(null); setConfirmation(null); refresh(); }
    }
  }

  const endpoint = data?.endpoint;
  const latest = data?.checks[0] ?? null;
  const selected = data?.checks.find(check => check.id === selectedId) ?? latest;
  const supported = endpoint ? supportedUrl(endpoint.url) !== null : false;
  const disabled = Boolean(busy || loading || error || !supported);

  return <>
    <a className="back-link" href="#endpoints">← All endpoints</a>
    <div className="page-heading"><div><p className="eyebrow">Endpoint detail</p><h1>{endpoint?.name ?? 'Endpoint'}</h1>{endpoint && <p className="mono endpoint-address">{endpoint.url}</p>}</div>
      <div className="actions"><button className="button" disabled={Boolean(loading || busy)} onClick={refresh}>{loading ? 'Loading…' : 'Refresh detail'}</button>
        <button className="button button-primary" disabled={disabled} onClick={() => void run('check')}>{busy === 'check' ? 'Checking…' : 'Run check'}</button></div>
    </div>
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {error && <Notice tone="error">{error}{data && ' Previously loaded data remains visible. Refresh successfully before running another action.'}</Notice>}
    {!data ? <div className="panel empty-state" aria-busy={loading}>{error ? 'Endpoint details could not be loaded. Use Refresh detail to retry.' : 'Loading endpoint and persisted history…'}</div> : <>
      {!supported && <Notice tone="warning">This saved URL is outside the current public test allowlist. Its history is available, but checking and baseline capture are disabled. See Local setup for supported URLs.</Notice>}
      <section className="panel" aria-labelledby="latest-heading" aria-busy={loading}>
        <div className="panel-heading"><h2 id="latest-heading">Latest persisted check</h2><span className="small muted">Saved monitoring results</span></div>
        <dl className="result-strip"><div><dt>Result</dt><dd><StatusBadge check={latest} /></dd></div>
          <div><dt>HTTP status</dt><dd className="mono">{latest?.httpStatus ?? '—'}</dd></div>
          <div><dt>Response time</dt><dd className="mono">{latest?.responseTimeMs != null ? `${latest.responseTimeMs} ms` : '—'}</dd></div>
          <div><dt>Checked at (UTC)</dt><dd><Timestamp value={latest?.checkedAt} /></dd></div></dl>
        {latest?.errorCode && <div className="panel-footer">Error category: <code>{latest.errorCode}</code></div>}
      </section>
      <section className="panel" aria-labelledby="baseline-heading">
        <div className="panel-heading"><h2 id="baseline-heading">Accepted baseline</h2><span className="small muted">{endpoint!.baselineSchema === null ? 'Not accepted' : 'Saved structure'}</span></div>
        <div className="baseline-content"><div><h3>{endpoint!.baselineSchema === null ? 'No baseline accepted' : 'Baseline accepted'}</h3>
          <p className="muted">{endpoint!.baselineSchema === null ? 'A successful check does not create one. Capture a fresh response to start comparing structure.' : 'Checks compare against this saved structure. It changes only after explicit acceptance.'}</p>
          <p className="small muted">Endpoint updated <Timestamp value={endpoint!.updatedAt} /> UTC</p></div>
          <button className="button" disabled={disabled} onClick={() => setConfirmation(endpoint!)}>{endpoint!.baselineSchema === null ? 'Capture baseline' : 'Replace baseline'}</button></div>
        {endpoint!.baselineSchema !== null && <details className="schema-preview"><summary>View saved schema</summary><pre>{JSON.stringify(endpoint!.baselineSchema, null, 2)}</pre></details>}
      </section>
      <CheckHistory checks={data.checks} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
      <SchemaChanges check={selected} baselineMissing={endpoint!.baselineSchema === null} />
    </>}
    {confirmation && <BaselineConfirmation endpoint={confirmation} busy={busy === 'baseline'} onClose={() => { if (!busy) setConfirmation(null); }} onConfirm={() => void run('baseline')} />}
  </>;
}
