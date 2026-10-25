import type { EmailJob } from './outbox-repository.js';

const labels = { failure: 'Endpoint failed', recovery: 'Endpoint recovered', schema_changed: 'Response structure changed', schema_restored: 'Response sample matches baseline' };
function clean(text: string, limit = 128) {
  const characters = [...text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')];
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : characters.join('');
}
export function mailpitRecipient(ownerId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) throw new Error('Invalid local notification owner.');
  return `watchtower+${ownerId.toLowerCase()}@example.test`;
}
export function notificationMessage(job: EmailJob) {
  const { event } = job; const check = event.checkResult;
  const changes = check.schemaChanges.slice(0, 20).map(change => `${clean(change.path)}: ${change.changeType} (${change.previousTypes.join(' | ') || 'absent'} -> ${change.currentTypes.join(' | ') || 'absent'})`);
  const text = [labels[event.kind], '', `Endpoint: ${clean(event.endpointName, 100)}`, `Observed at (UTC): ${check.checkedAt.toISOString()}`,
    `HTTP status: ${check.httpStatus ?? 'Unavailable'}`, `Response time: ${check.responseTimeMs === null ? 'Unavailable' : `${check.responseTimeMs} ms`}`,
    `Result: ${check.outcome}`, `Error category: ${check.errorCode ?? 'None recorded'}`, `Incident: ${event.incidentId}`, `Check: ${check.id}`,
    ...(changes.length ? ['', 'Observed structural differences:', ...changes, ...(check.schemaChanges.length > 20 ? [`${check.schemaChanges.length - 20} additional differences are available in authenticated history.`] : [])] : []),
    '', 'Schema observations are samples, not a universal compatibility guarantee. Baselines are never replaced automatically.',
    'Local Mailpit capture only. SMTP acceptance is not proof of delivery to a real inbox.'].join('\n');
  return { from: 'API Watchtower <watchtower@example.test>', to: mailpitRecipient(event.ownerId), subject: `${labels[event.kind]}: ${clean(event.endpointName, 100)}`,
    messageId: `<${event.id}@api-watchtower.test>`, text };
}
