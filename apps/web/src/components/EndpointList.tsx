import { useEffect, useState } from 'react';
import { errorMessage, loadEndpointRows } from '../api/client';
import type { Endpoint, EndpointRow } from '../api/types';
import { Notice, StatusBadge, Timestamp } from './common';

export function EndpointList({ onAdd, registrationRevision = 0, registered }: { onAdd: () => void; registrationRevision?: number; registered?: Endpoint | null }) {
  const [rows, setRows] = useState<EndpointRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    void loadEndpointRows(controller.signal).then(data => {
      if (!controller.signal.aborted) setRows(data);
    }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, registrationRevision]);
  const unavailable = rows?.filter(row => row.historyError).length ?? 0;

  return <>
    <div className="page-heading"><div><p className="eyebrow">Workspace</p><h1>Endpoints</h1><p className="muted">Saved checks and observed response structures.</p></div>
      <div className="actions"><button className="button" onClick={() => setRevision(value => value + 1)} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button><button className="button button-primary" onClick={onAdd}>Add endpoint</button></div>
    </div>
    {registered && <Notice tone="success">Registered {registered.name}. No checks have run automatically.</Notice>}
    {error && <Notice tone="error">{error}{rows && ' Previously loaded data is shown below.'}</Notice>}
    {unavailable > 0 && <Notice tone="warning">Latest results are unavailable for {unavailable} {unavailable === 1 ? 'endpoint' : 'endpoints'}. Open an endpoint or refresh to retry; these are not “never checked” results.</Notice>}
    <section className="panel" aria-labelledby="registered-heading" aria-busy={loading}>
      <div className="panel-heading"><h2 id="registered-heading">Registered endpoints</h2><span className="small muted">{rows ? `${rows.length} in this view` : 'Loading records'}</span></div>
      {rows === null ? <div className="empty-state">{error ? 'Endpoint data could not be loaded. Use Refresh to retry.' : 'Loading registered endpoints and latest results…'}</div>
        : rows.length === 0 ? <div className="empty-state"><h3>No endpoints registered</h3><p>Add a supported public test URL to make your first manual check.</p><button className="button" onClick={onAdd}>Add your first endpoint</button></div>
          : <div className="table-scroll" role="region" aria-label="Endpoint table. Scroll horizontally to view all columns." tabIndex={0}><table className="data-table endpoint-table"><caption className="sr-only">Registered endpoints and their latest persisted check</caption><thead><tr><th>Endpoint</th><th>URL</th><th>Latest result</th><th>Last checked <span className="muted">(UTC)</span></th><th className="numeric">Latency</th></tr></thead>
            <tbody>{rows.map(({ endpoint, latest, historyError }) => <tr key={endpoint.id}>
              <td><a className="endpoint-link" href={`#endpoints/${endpoint.id}`}>{endpoint.name}</a><span className="cell-note">{endpoint.baselineSchema === null ? 'No accepted baseline' : 'Baseline accepted'}</span></td>
              <td><span className="mono url-cell" title={endpoint.url}>{endpoint.url}</span></td>
              <td><StatusBadge check={latest} unavailable={historyError !== null} /></td>
              <td><Timestamp value={latest?.checkedAt} /></td>
              <td className="numeric mono">{latest?.responseTimeMs != null ? `${latest.responseTimeMs} ms` : '—'}</td>
            </tr>)}</tbody></table></div>}
      <div className="panel-footer">Latest saved result per endpoint. Healthy describes a successful HTTP/JSON check, not guaranteed compatibility.{rows?.length === 100 && ' Showing the latest 100 registrations; pagination is not available yet.'}</div>
    </section>
    <p className="page-note">Use Refresh to load changes from another session or an active worker. Opening this page does not start background checks.</p>
  </>;
}
