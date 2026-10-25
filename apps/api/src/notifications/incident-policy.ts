import { createHash } from 'node:crypto';
import type { CheckOutcome, IncidentKind, NotificationKind } from '../generated/prisma/client.js';

export interface Observation {
  outcome: CheckOutcome;
  hasBaseline: boolean;
  changes: { path: string; changeType: string; previousTypes: readonly string[]; currentTypes: readonly string[] }[];
}
export interface ActiveIncident { id: string; kind: IncidentKind; fingerprint: string | null }
export interface Transition {
  action: 'open' | 'update' | 'close';
  kind: IncidentKind;
  event: NotificationKind;
  fingerprint: string | null;
  resolution?: 'check_recovered' | 'sample_matches_baseline';
}

export function schemaFingerprint(changes: Observation['changes']): string {
  const normalized = changes.map(change => ({ path: change.path, changeType: change.changeType,
    previousTypes: [...new Set(change.previousTypes)].sort(), currentTypes: [...new Set(change.currentTypes)].sort() }))
    .map(change => JSON.stringify(change)).sort();
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/** Only observed transitions produce events; repeated samples do not replay alerts. */
export function incidentTransitions(observation: Observation, active: ActiveIncident[]): Transition[] {
  const availability = active.find(incident => incident.kind === 'availability');
  const schema = active.find(incident => incident.kind === 'schema');
  const failed = !['success', 'schema_changed'].includes(observation.outcome);
  if (failed) return availability ? [] : [{ action: 'open', kind: 'availability', event: 'failure', fingerprint: null }];
  const transitions: Transition[] = availability ? [{ action: 'close', kind: 'availability', event: 'recovery', fingerprint: null, resolution: 'check_recovered' }] : [];
  // An unknown/missing baseline never establishes schema compatibility or a schema change.
  if (!observation.hasBaseline) return transitions;
  if (observation.changes.length) {
    const fingerprint = schemaFingerprint(observation.changes);
    if (!schema || schema.fingerprint !== fingerprint) transitions.push({ action: schema ? 'update' : 'open', kind: 'schema', event: 'schema_changed', fingerprint });
  } else if (schema) transitions.push({ action: 'close', kind: 'schema', event: 'schema_restored', fingerprint: null, resolution: 'sample_matches_baseline' });
  return transitions;
}
