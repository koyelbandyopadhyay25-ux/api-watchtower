import { useState } from 'react';
import type { CheckResult } from '../api/types';
import { Notice, StatusBadge, Timestamp } from '../components/common';
import { DEMO_ENDPOINTS, type DemoEndpoint } from './sample-data';
import './demo.css';

type View = 'endpoints' | 'detail' | 'about';

function formatTypes(types: string[]) { return types.length ? types.join(' | ') : 'Absent'; }

function EndpointTable({ selected, onSelect }: { selected: string; onSelect: (endpoint: DemoEndpoint) => void }) {
  return <section className="panel" aria-labelledby="demo-endpoints-heading">
    <div className="panel-heading"><h2 id="demo-endpoints-heading">Sample endpoints</h2><span className="demo-record-label">Illustrative records</span></div>
    <div className="table-scroll" role="region" aria-label="Sample endpoint table. Scroll horizontally to view all columns." tabIndex={0}>
      <table className="data-table endpoint-table"><caption className="sr-only">Illustrative endpoints and example monitoring results</caption><thead><tr><th>Endpoint</th><th>URL</th><th>Example result</th><th>Last checked (sample, UTC)</th><th className="numeric">Latency</th></tr></thead>
        <tbody>{DEMO_ENDPOINTS.map(item => {
          const { endpoint, checks } = item;
          const latest = checks[0]!;
          return <tr key={endpoint.id} className={selected === endpoint.id ? 'selected-row' : ''}>
            <td><button className="demo-endpoint-link" onClick={() => onSelect(item)}>{endpoint.name}</button><span className="cell-note">{endpoint.baselineSchema ? 'Sample baseline accepted' : 'No sample baseline'}</span></td>
            <td><span className="mono url-cell" title={endpoint.url}>{endpoint.url}</span></td><td><StatusBadge check={latest} /></td>
            <td><Timestamp value={latest.checkedAt} /><span className="cell-note">Illustrative sample</span></td><td className="numeric mono">{latest.responseTimeMs === null ? '—' : `${latest.responseTimeMs} ms`}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="panel-footer">Every row is example content for exploring the interface. No endpoint is contacted and no result is stored.</div>
  </section>;
}

function SampleHistory({ endpoint, selectedCheckId, onSelect }: { endpoint: DemoEndpoint; selectedCheckId: string; onSelect: (check: CheckResult) => void }) {
  return <section className="panel" aria-labelledby="demo-history-heading">
    <div className="panel-heading"><h2 id="demo-history-heading">Example monitoring history</h2><span className="demo-record-label">Sample data</span></div>
    <div className="table-scroll" role="region" aria-label="Example check history. Scroll horizontally to view all columns." tabIndex={0}>
      <table className="data-table history-table"><caption className="sr-only">Sample monitoring checks, newest first</caption><thead><tr><th>Checked at (sample, UTC)</th><th>Example result</th><th>HTTP</th><th className="numeric">Latency</th><th>Error category</th><th className="numeric">Changes</th><th><span className="sr-only">Inspect sample check</span></th></tr></thead><tbody>
        {endpoint.checks.map(check => <tr key={check.id} className={selectedCheckId === check.id ? 'selected-row' : ''}>
          <td><Timestamp value={check.checkedAt} /><div className="small muted">{check.scheduledCheck ? 'Scheduled (sample)' : 'Manual (sample)'}</div></td><td><StatusBadge check={check} /> <span className="demo-mini-label">Sample</span></td>
          <td className="mono">{check.httpStatus ?? '—'}</td><td className="mono numeric">{check.responseTimeMs === null ? '—' : `${check.responseTimeMs} ms`}</td><td className="mono muted">{check.errorCode ?? '—'}</td><td className="numeric mono">{check.schemaChanges.length}</td>
          <td><button className="text-button nowrap" aria-pressed={selectedCheckId === check.id} onClick={() => onSelect(check)}>{selectedCheckId === check.id ? 'Selected' : 'View sample'}</button></td>
        </tr>)}
      </tbody></table>
    </div>
    <div className="panel-footer">Sample timestamps and latency are illustrative. These are not persisted checks or measured provider performance.</div>
  </section>;
}

function SchemaPanel({ check }: { check: CheckResult }) {
  const failed = !['success', 'schema_changed'].includes(check.outcome);
  return <section className="panel" aria-labelledby="demo-schema-heading">
    <div className="panel-heading"><h2 id="demo-schema-heading">Example schema comparison</h2><span className="demo-record-label">Illustrative</span></div>
    {check.schemaChanges.length ? <div className="table-scroll" role="region" aria-label="Example schema differences" tabIndex={0}>
      <table className="data-table changes-table"><thead><tr><th>Field path</th><th>Change</th><th>Previous type</th><th>Current type</th></tr></thead><tbody>
        {check.schemaChanges.map(change => <tr key={change.id}><td className="mono field-path">{change.path}</td><td><span className={`change-tag change-${change.changeType}`}>{change.changeType === 'type_changed' ? 'Type changed' : change.changeType === 'added' ? 'Added' : 'Removed'}</span></td>
          <td className="mono">{formatTypes(change.previousTypes)}</td><td className="mono">{formatTypes(change.currentTypes)}</td></tr>)}
      </tbody></table></div>
      : <div className="panel-content"><h3>{failed ? 'No comparison for this sample failure' : 'No sample differences recorded'}</h3><p className="muted">This illustrative record has no structural changes attached to it.</p></div>}
    <div className="panel-footer">A sample comparison illustrates the display only. In the local app, comparisons require an explicitly accepted baseline; no detected difference does not prove complete compatibility.</div>
  </section>;
}

function BaselinePanel({ endpoint }: { endpoint: DemoEndpoint }) {
  return <section className="panel" aria-labelledby="demo-baseline-heading">
    <div className="panel-heading"><h2 id="demo-baseline-heading">Example accepted baseline</h2><span className="demo-record-label">Sample structure</span></div>
    {endpoint.endpoint.baselineSchema ? <details className="schema-preview"><summary>View example JSON structure</summary><pre>{JSON.stringify(endpoint.endpoint.baselineSchema, null, 2)}</pre></details>
      : <div className="panel-content"><h3>No sample baseline</h3><p className="muted">This example represents an endpoint before baseline acceptance.</p></div>}
    <div className="panel-footer">The hosted demo cannot capture or replace a real baseline.</div>
  </section>;
}

function MonitoringPanel({ endpoint }: { endpoint: DemoEndpoint }) {
  const schedule = endpoint.schedule;
  return <section className="panel" aria-labelledby="demo-schedule-heading">
    <div className="panel-heading"><h2 id="demo-schedule-heading">Example monitoring settings</h2><span className="demo-record-label">View only</span></div>
    <div className="panel-content">
      <p className="small muted">The local product saves opt-in schedules in PostgreSQL. Automatic checks require its separate worker. This hosted example has no worker and changes are not available.</p>
      <dl className="schedule-summary demo-schedule-summary"><div><dt>Example setting</dt><dd>{schedule.enabled ? 'Enabled in sample' : 'Disabled in sample'} · Every {schedule.intervalMinutes} minutes</dd></div>
        <div><dt>Example next check (UTC)</dt><dd><Timestamp value={schedule.nextCheck} /></dd></div>
        <div><dt>Example last result</dt><dd>{schedule.lastResult ? <StatusBadge check={endpoint.checks.find(check => check.outcome === schedule.lastResult) ?? endpoint.checks[0]!} /> : 'No sample result'}</dd></div>
      </dl>
    </div>
  </section>;
}

function NotificationPanel({ endpoint }: { endpoint: DemoEndpoint }) {
  return <section className="panel" aria-labelledby="demo-notifications-heading">
    <div className="panel-heading"><h2 id="demo-notifications-heading">Example incidents and notifications</h2><span className="demo-record-label">Sample history</span></div>
    <div className="panel-content"><p className="small muted">Local email is captured in Mailpit only. This static hosted demo sends no email. “SMTP accepted” below is just an illustrative sample label, not a message sent from this website.</p></div>
    {endpoint.notifications.length ? <div className="table-scroll" role="region" aria-label="Example notification history" tabIndex={0}>
      <table className="data-table notification-table"><thead><tr><th>Observed at (sample, UTC)</th><th>Example event</th><th>Incident</th><th>Example outbox state</th></tr></thead><tbody>
        {endpoint.notifications.map(item => <tr key={item.id}><td><Timestamp value={item.createdAt} /></td><td>{item.event}</td><td>{item.incident}</td><td>{item.emailState}</td></tr>)}
      </tbody></table></div> : <div className="panel-content muted">No notification events in this sample.</div>}
    <div className="panel-footer">Notification preferences and history are illustrative and are not user-specific or connected to a database.</div>
  </section>;
}

export function DemoApp({ repositoryUrl = '' }: { repositoryUrl?: string }) {
  const [view, setView] = useState<View>('endpoints');
  const [selected, setSelected] = useState(DEMO_ENDPOINTS[2]!);
  const [selectedCheck, setSelectedCheck] = useState(selected.checks[0]!);
  const inferredOwner = window.location.hostname.endsWith('.github.io') ? window.location.hostname.slice(0, -'.github.io'.length) : null;
  const sourceUrl = repositoryUrl || (inferredOwner ? `https://github.com/${inferredOwner}/api-watchtower` : 'https://github.com');

  function selectEndpoint(endpoint: DemoEndpoint) {
    setSelected(endpoint);
    setSelectedCheck(endpoint.checks[0]!);
    setView('detail');
  }

  return <div className="workspace demo-workspace">
    <a className="skip-link" href="#demo-main">Skip to content</a>
    <aside className="sidebar"><a className="wordmark" href="#demo-endpoints" onClick={event => { event.preventDefault(); setView('endpoints'); }}><span>API</span> Watchtower</a>
      <p className="sidebar-label">PORTFOLIO DEMO</p><nav aria-label="Demo navigation">
        <a href="#demo-endpoints" className={view === 'endpoints' || view === 'detail' ? 'nav-active' : ''} aria-current={view !== 'about' ? 'page' : undefined} onClick={event => { event.preventDefault(); setView('endpoints'); }}>Endpoints</a>
        <a href="#demo-about" className={view === 'about' ? 'nav-active' : ''} aria-current={view === 'about' ? 'page' : undefined} onClick={event => { event.preventDefault(); setView('about'); }}>About this demo</a>
      </nav><div className="sidebar-footer"><span className="sidebar-label">DEMO MODE</span><p>Sample data only.<br />No account or API connection.</p></div>
    </aside>
    <div className="workspace-body"><header className="topbar"><span>Workspace <span className="breadcrumb-slash">/</span> {view === 'about' ? 'About this demo' : view === 'detail' ? selected.endpoint.name : 'Endpoints'}</span>
      <div className="actions"><a className="text-button demo-source-link" href={sourceUrl} target="_blank" rel="noreferrer">View source on GitHub</a><span className="environment-label">Demo Mode</span></div></header>
      <main id="demo-main" className="main-content" tabIndex={-1}>
        <Notice><strong>Demo Mode.</strong> This GitHub Pages site is a frontend-only demonstration. All endpoint results, timestamps, schedules, incidents, and notifications are illustrative sample data. It makes no API requests, has no login, and does not connect to PostgreSQL or send email.</Notice>
        {view === 'endpoints' && <>
          <div className="page-heading"><div><p className="eyebrow">Workspace · Sample data</p><h1>Endpoints</h1><p className="muted">Explore example monitoring results and structural comparisons.</p></div>
            <a className="button" href="#demo-about" onClick={event => { event.preventDefault(); setView('about'); }}>How this demo works</a></div>
          <EndpointTable selected={selected.endpoint.id} onSelect={selectEndpoint} />
          <section className="panel"><div className="panel-heading"><h2>Explore a sample endpoint</h2><span className="small muted">Choose a row to open its detail view</span></div>
            <div className="demo-endpoint-picker">{DEMO_ENDPOINTS.map(item => <button key={item.endpoint.id} className="button" onClick={() => selectEndpoint(item)}>{item.endpoint.name}<span className="demo-picker-arrow" aria-hidden="true">→</span></button>)}</div>
            <div className="panel-footer">The endpoint catalog in the real local application is limited to six exact reviewed URLs. The sample rows above are not live checks.</div>
          </section>
        </>}
        {view === 'detail' && <>
          <button className="back-link demo-back" onClick={() => setView('endpoints')}>← All sample endpoints</button>
          <div className="page-heading"><div><p className="eyebrow">Endpoint detail · Sample data</p><h1>{selected.endpoint.name}</h1><p className="mono endpoint-address">{selected.endpoint.url}</p></div>
            <span className="demo-record-label">Example result · not a live check</span></div>
          <section className="panel" aria-labelledby="demo-latest-heading"><div className="panel-heading"><h2 id="demo-latest-heading">Example latest result</h2><span className="demo-record-label">Illustrative</span></div>
            <dl className="result-strip"><div><dt>Result</dt><dd><StatusBadge check={selected.checks[0]!} /></dd></div><div><dt>HTTP status (sample)</dt><dd className="mono">{selected.checks[0]!.httpStatus ?? '—'}</dd></div>
              <div><dt>Latency (sample)</dt><dd className="mono">{selected.checks[0]!.responseTimeMs === null ? '—' : `${selected.checks[0]!.responseTimeMs} ms`}</dd></div><div><dt>Checked at (sample UTC)</dt><dd><Timestamp value={selected.checks[0]!.checkedAt} /></dd></div></dl>
            <div className="panel-footer">This is a fixed sample record. The “View sample” controls below only change which example comparison is displayed.</div></section>
          <BaselinePanel endpoint={selected} />
          <MonitoringPanel endpoint={selected} />
          <SampleHistory endpoint={selected} selectedCheckId={selectedCheck.id} onSelect={setSelectedCheck} />
          <SchemaPanel check={selectedCheck} />
          <NotificationPanel endpoint={selected} />
        </>}
        {view === 'about' && <section id="demo-about" className="panel demo-about"><div className="panel-heading"><h1>About this demonstration</h1><span className="demo-record-label">Frontend only</span></div>
          <div className="panel-content readable"><p>This static site reuses API Watchtower’s dashboard styling to show how endpoint monitoring, schema differences, schedules, and notification history are presented.</p>
            <h2>What is sample data?</h2><p>Every result, response time, timestamp, baseline, schedule, incident, and delivery label is an illustrative UI example. It does not represent a request made by this site or current provider status.</p>
            <h2>What is disabled here?</h2><p>Registration, login, endpoint creation, check execution, baseline capture, schedule changes, database access, and email delivery are unavailable in the hosted demo. No browser storage is used for authentication.</p>
            <h2>Try it</h2><p>Return to Endpoints and choose a row. In an endpoint detail view, select another sample history row to inspect its example structural comparison.</p>
            <p><a className="inline-link" href={sourceUrl} target="_blank" rel="noreferrer">Read the source code on GitHub</a></p>
          </div></section>}
        <p className="page-note">Portfolio demonstration only · <a href={sourceUrl} target="_blank" rel="noreferrer">Source code</a></p>
      </main>
    </div>
  </div>;
}
