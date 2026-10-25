import type { CheckResult } from '../api/types';
import { StatusBadge, Timestamp } from './common';

export function CheckHistory({ checks, selectedId, onSelect }: { checks: CheckResult[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return <section className="panel" aria-labelledby="history-heading">
    <div className="panel-heading"><h2 id="history-heading">Monitoring history</h2><span className="small muted">{checks.length} saved {checks.length === 1 ? 'check' : 'checks'} in this view</span></div>
    {checks.length === 0 ? <div className="empty-state"><h3>No checks recorded</h3><p>Run a manual check to save its actual HTTP result and timing.</p></div>
      : <div className="table-scroll" role="region" aria-label="History table. Scroll horizontally to view all columns." tabIndex={0}><table className="data-table history-table"><caption className="sr-only">Persisted checks, newest first</caption><thead><tr><th>Checked at (UTC)</th><th>Result</th><th>HTTP</th><th className="numeric">Latency</th><th>Error category</th><th className="numeric">Changes</th><th><span className="sr-only">Inspect check</span></th></tr></thead><tbody>
        {checks.map(check => <tr key={check.id} className={selectedId === check.id ? 'selected-row' : ''}>
          <td><Timestamp value={check.checkedAt} /></td><td><StatusBadge check={check} /></td>
          <td className="mono">{check.httpStatus ?? '—'}</td><td className="mono numeric">{check.responseTimeMs !== null ? `${check.responseTimeMs} ms` : '—'}</td>
          <td className="mono muted">{check.errorCode ?? '—'}</td><td className="numeric mono">{check.schemaChanges.length}</td>
          <td><button className="text-button nowrap" aria-pressed={selectedId === check.id} aria-label={`View changes for check ${check.id}`} onClick={() => onSelect(check.id)}>{selectedId === check.id ? 'Selected' : 'View changes'}</button></td>
        </tr>)}
      </tbody></table></div>}
    <div className="panel-footer">Newest first, up to 100 checks. Times are UTC. Earlier history is retained in PostgreSQL.</div>
  </section>;
}

export function SchemaChanges({ check, baselineMissing }: { check: CheckResult | null; baselineMissing: boolean }) {
  const failed = check && !['success', 'schema_changed'].includes(check.outcome);
  return <section className="panel" aria-labelledby="changes-heading">
    <div className="panel-heading"><h2 id="changes-heading">Recorded schema changes</h2>{check && <span className="small muted">Selected check · <Timestamp value={check.checkedAt} /></span>}</div>
    {!check ? <div className="panel-content muted">No check selected. Recorded field differences will appear here.</div>
      : check.schemaChanges.length > 0 ? <div className="table-scroll" role="region" aria-label="Schema changes table. Scroll horizontally to view all columns." tabIndex={0}><table className="data-table changes-table"><caption className="sr-only">Structural differences recorded for the selected check</caption><thead><tr><th>Field path</th><th>Change</th><th>Previous types</th><th>Current types</th></tr></thead><tbody>
        {check.schemaChanges.map(change => <tr key={change.id}><td className="mono field-path">{change.path}</td>
          <td><span className={`change-tag change-${change.changeType}`}>{change.changeType === 'type_changed' ? 'Type changed' : change.changeType === 'added' ? 'Added' : 'Removed'}</span></td>
          <td className="mono">{change.previousTypes.join(' | ') || 'Absent'}</td><td className="mono">{change.currentTypes.join(' | ') || 'Absent'}</td></tr>)}
      </tbody></table></div>
        : <div className="panel-content"><h3>{failed ? 'Comparison unavailable for this check' : baselineMissing ? 'No baseline accepted' : 'No structural changes recorded'}</h3>
          <p className="muted">{failed ? 'The request or JSON validation failed. No schema comparison is recorded for this attempt.'
            : baselineMissing ? 'Capture a baseline explicitly before comparing response structure. A successful HTTP check alone does not establish compatibility.'
              : 'This check has no recorded field differences. Checks made before a baseline was accepted also have no comparison.'}</p></div>}
    <div className="panel-footer">No detected changes does not prove complete compatibility. Arrays and optional fields are inferred conservatively from observed samples.</div>
  </section>;
}
