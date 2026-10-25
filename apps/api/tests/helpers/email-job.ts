import type { EmailJob } from '../../src/notifications/outbox-repository.js';

export const emailOwner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const emailEndpoint = '11111111-1111-4111-8111-111111111111';
export function emailJob(): EmailJob {
  const time = new Date('2026-10-25T16:00:00Z');
  const id = '22222222-2222-4222-8222-222222222222';
  return {
    eventId: id, state: 'processing', attempts: 1, availableAt: time, leaseToken: '33333333-3333-4333-8333-333333333333', leaseExpiresAt: new Date(time.getTime() + 60_000), finishedAt: null, lastErrorCode: null,
    event: { id, endpointId: emailEndpoint, ownerId: emailOwner, endpointName: 'Todo API', incidentId: '44444444-4444-4444-8444-444444444444', checkResultId: '55555555-5555-4555-8555-555555555555', kind: 'failure', createdAt: time,
      endpoint: { id: emailEndpoint, ownerId: emailOwner, name: 'Todo API', url: 'https://jsonplaceholder.typicode.com/todos/1', baselineSchema: null, createdAt: time, updatedAt: time },
      checkResult: { id: '55555555-5555-4555-8555-555555555555', endpointId: emailEndpoint, outcome: 'network_error', httpStatus: null, responseTimeMs: 8000, errorCode: 'timeout', checkedAt: time, schemaChanges: [] },
    },
  };
}
