import { useRef, useState, type FormEvent } from 'react';
import { api, errorMessage, SUPPORTED_URLS, supportedUrl } from '../api/client';
import type { Endpoint } from '../api/types';
import { Modal, Notice } from './common';

export function AddEndpoint({ onClose, onCreated }: { onClose: () => void; onCreated: (endpoint: Endpoint) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || name.trim().length > 100) {
      setError('Enter an endpoint name between 1 and 100 characters.'); nameRef.current?.focus(); return;
    }
    const target = supportedUrl(url);
    if (!target) {
      setError('This URL is not supported. Use the Todo or Post preset below. Only these exact public test URLs are allowed.'); urlRef.current?.focus(); return;
    }
    setBusy(true); setError(null);
    try { onCreated(await api.register(name.trim(), target)); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <Modal title="Add endpoint" onClose={onClose} busy={busy}>
    <form onSubmit={submit} noValidate className="modal-body">
      <p className="muted">Register a public test endpoint. Checks run only when you request them.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <label htmlFor="endpoint-name">Endpoint name</label>
      <input id="endpoint-name" ref={nameRef} autoFocus maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={busy} placeholder="e.g. Todo response" required />
      <label htmlFor="endpoint-url">HTTPS URL</label>
      <input id="endpoint-url" ref={urlRef} className="mono" type="url" value={url} onChange={event => setUrl(event.target.value)} disabled={busy} placeholder="https://…" aria-describedby="supported-urls" required />
      <div className="presets" id="supported-urls"><span className="muted">Supported presets:</span>
        <button type="button" className="text-button" onClick={() => setUrl(SUPPORTED_URLS[0])} disabled={busy}>Todo</button>
        <button type="button" className="text-button" onClick={() => setUrl(SUPPORTED_URLS[1])} disabled={busy}>Post</button>
      </div>
      <p className="small muted">Only <span className="mono">/todos/1</span> and <span className="mono">/posts/1</span> on JSONPlaceholder are supported. Registration does not make a check or accept a baseline.</p>
      <div className="form-actions"><button type="button" className="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Registering…' : 'Register endpoint'}</button></div>
    </form>
  </Modal>;
}
