import { useRef, useState, type FormEvent } from 'react';
import { api, errorMessage, SUPPORTED_ENDPOINTS, supportedUrl } from '../api/client';
import type { Endpoint } from '../api/types';
import { Modal, Notice } from './common';

export function AddEndpoint({ onClose, onCreated }: { onClose: () => void; onCreated: (endpoint: Endpoint) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLSelectElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || name.trim().length > 100) {
      setError('Enter an endpoint name between 1 and 100 characters.'); nameRef.current?.focus(); return;
    }
    const target = supportedUrl(url);
    if (!target) {
      setError('Choose one of the four exact supported JSONPlaceholder destinations.'); urlRef.current?.focus(); return;
    }
    setBusy(true); setError(null);
    try { onCreated(await api.register(name.trim(), target)); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <Modal title="Add endpoint" onClose={onClose} busy={busy}>
    <form onSubmit={submit} noValidate className="modal-body">
      <p className="muted">Register one of four public test endpoints. Checks run only when you request them.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <label htmlFor="endpoint-name">Endpoint name</label>
      <input id="endpoint-name" ref={nameRef} autoFocus maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={busy} placeholder="e.g. Todo response" required />
      <label htmlFor="endpoint-url">Supported API destination</label>
      <select id="endpoint-url" ref={urlRef} value={url} onChange={event => setUrl(event.target.value)} disabled={busy} aria-describedby="supported-urls" required>
        <option value="">Choose an approved destination</option>
        {SUPPORTED_ENDPOINTS.map(endpoint => <option key={endpoint.url} value={endpoint.url}>{endpoint.label} — {endpoint.path}</option>)}
      </select>
      <p id="supported-urls" className="small muted">Only these four exact HTTPS destinations on JSONPlaceholder are available. No other domains or paths can be monitored.</p>
      {url && <p className="small mono endpoint-url-preview">{url}</p>}
      <p className="small muted">Registration does not make a check or accept a baseline.</p>
      <div className="form-actions"><button type="button" className="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Registering…' : 'Register endpoint'}</button></div>
    </form>
  </Modal>;
}
