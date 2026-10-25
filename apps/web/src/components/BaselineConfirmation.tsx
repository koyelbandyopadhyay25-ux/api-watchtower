import { useState } from 'react';
import type { Endpoint } from '../api/types';
import { Modal } from './common';

export function BaselineConfirmation({ endpoint, busy, onClose, onConfirm }: { endpoint: Endpoint; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const replacing = endpoint.baselineSchema !== null;
  return <Modal title={replacing ? 'Replace accepted baseline?' : 'Accept a baseline?'} busy={busy} onClose={onClose}>
    <div className="modal-body">
      <p>This makes a <strong>fresh HTTPS request</strong> to <strong>{endpoint.name}</strong> and accepts its observed structure{replacing ? ' in place of the saved baseline' : ' as the baseline'}.</p>
      <p className="mono wrap muted">{endpoint.url}</p>
      <p>Existing history is retained. The captured sample does not define a universal API contract.</p>
      <label className="checkbox-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
        <span>{replacing ? 'I understand this replaces the saved baseline.' : 'I want to accept this fresh response as the baseline.'}</span></label>
      <div className="form-actions"><button className="button" onClick={onClose} disabled={busy} autoFocus>Cancel</button>
        <button className="button button-primary" onClick={onConfirm} disabled={!confirmed || busy}>{busy ? 'Capturing…' : replacing ? 'Replace baseline' : 'Accept baseline'}</button></div>
    </div>
  </Modal>;
}
