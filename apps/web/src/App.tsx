import { useEffect, useRef, useState } from 'react';
import { SUPPORTED_URLS } from './api/client';
import type { Endpoint } from './api/types';
import { AddEndpoint } from './components/AddEndpoint';
import { EndpointDetail } from './components/EndpointDetail';
import { EndpointList } from './components/EndpointList';

function readView() {
  const hash = window.location.hash;
  if (!hash || hash === '#endpoints') return { kind: 'list' as const };
  if (hash === '#setup') return { kind: 'setup' as const };
  const match = /^#endpoints\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(hash);
  return match ? { kind: 'detail' as const, id: match[1]!.toLowerCase() } : { kind: 'missing' as const };
}

function LocalSetup() {
  return <><div className="page-heading"><div><p className="eyebrow">Workspace</p><h1>Local setup</h1><p className="muted">The dashboard connects to the local API through Vite.</p></div></div>
    <section className="panel"><div className="panel-heading"><h2>Enable management explicitly</h2></div><div className="panel-content readable">
      <p>Use the existing migrated PostgreSQL databases. Keep credentials in <code>apps/api/.env</code>, never in frontend files. Do not reinitialize a populated database.</p>
      <p>From the repository root, start both applications in a PowerShell terminal:</p>
      <pre className="command-block">{"$env:NODE_ENV = 'development'\n$env:ENABLE_LOCAL_MANAGEMENT = 'true'\nnpm run dev"}</pre>
      <p>The frontend uses port <code>5173</code>, and the API uses <code>3001</code>. Management requests stay on the local Vite proxy and include the required local header.</p>
      <p><a className="inline-link" href="/api/health" target="_blank" rel="noreferrer">Open process health in a new tab</a>. Process health does not verify PostgreSQL readiness.</p>
    </div></section>
    <section className="panel"><div className="panel-heading"><h2>Supported public test endpoints</h2></div><div className="panel-content readable">
      <ul className="url-list">{SUPPORTED_URLS.map(url => <li key={url}><code>{url}</code></li>)}</ul>
      <p>Only these exact URLs are supported. Checks use HTTPS on port 443, refuse redirects, and enforce destination, time, size, and concurrency limits.</p>
      <p>All checks and baseline captures are manual. This local tool has no authentication or scheduled monitoring; keep it bound to localhost.</p>
    </div></section></>;
}

export function App() {
  const [view, setView] = useState(readView);
  const [adding, setAdding] = useState(false);
  const [registered, setRegistered] = useState<Endpoint | null>(null);
  const [registrationRevision, setRegistrationRevision] = useState(0);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const change = () => { setView(readView()); setRegistered(null); setAdding(false); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => { main.current?.focus(); }, [view]);
  return <div className="workspace">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); main.current?.focus(); }}>Skip to content</a>
    <aside className="sidebar"><a className="wordmark" href="#endpoints"><span>API</span> Watchtower</a>
      <p className="sidebar-label">WORKSPACE</p><nav aria-label="Main navigation">
        <a href="#endpoints" className={view.kind === 'list' || view.kind === 'detail' ? 'nav-active' : ''} aria-current={view.kind === 'list' ? 'page' : undefined}>Endpoints</a>
        <a href="#setup" className={view.kind === 'setup' ? 'nav-active' : ''} aria-current={view.kind === 'setup' ? 'page' : undefined}>Local setup</a>
      </nav><div className="sidebar-footer"><span className="sidebar-label">LOCAL WORKSPACE</span><p>Manual checks only.<br />No scheduled activity.</p></div>
    </aside>
    <div className="workspace-body"><header className="topbar"><span>Workspace <span className="breadcrumb-slash">/</span> {view.kind === 'setup' ? 'Local setup' : 'Endpoints'}</span><span className="environment-label">Local development</span></header>
      <main id="main-content" className="main-content" ref={main} tabIndex={-1}>
        {view.kind === 'list' && <EndpointList onAdd={() => setAdding(true)} registered={registered} registrationRevision={registrationRevision} />}
        {view.kind === 'detail' && <EndpointDetail key={view.id} id={view.id} />}
        {view.kind === 'setup' && <LocalSetup />}
        {view.kind === 'missing' && <div className="panel empty-state"><h1>Page not found</h1><p><a href="#endpoints" className="inline-link">Return to endpoints</a></p></div>}
      </main>
    </div>
    {adding && <AddEndpoint onClose={() => setAdding(false)} onCreated={endpoint => { setAdding(false); setRegistered(endpoint); setRegistrationRevision(value => value + 1); }} />}
  </div>;
}
