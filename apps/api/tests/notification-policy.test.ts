import { describe, expect, it } from 'vitest';
import { incidentTransitions, schemaFingerprint, type Observation, type ActiveIncident } from '../src/notifications/incident-policy.js';
import { notificationMessage, mailpitRecipient } from '../src/notifications/email-template.js';
import { emailDispatcherConnectionString } from '../src/notifications/mailpit-sender.js';
import { retryDelayMs } from '../src/notifications/delivery-policy.js';
import { emailJob, emailOwner } from './helpers/email-job.js';

const change = { path: '$.id', changeType: 'type_changed', previousTypes: ['number'], currentTypes: ['string'] };
const failure: Observation = { outcome: 'network_error', hasBaseline: false, changes: [] };
const success: Observation = { outcome: 'success', hasBaseline: true, changes: [] };
const changed: Observation = { outcome: 'schema_changed', hasBaseline: true, changes: [change] };
const availability: ActiveIncident = { id: 'availability', kind: 'availability', fingerprint: null };
const schema: ActiveIncident = { id: 'schema', kind: 'schema', fingerprint: schemaFingerprint([change]) };

describe('incident transitions from actual check metadata', () => {
  it('opens a first failure even without a baseline', () => expect(incidentTransitions(failure, [])).toEqual([{ action: 'open', kind: 'availability', event: 'failure', fingerprint: null }]));
  it('deduplicates repeated failures', () => expect(incidentTransitions(failure, [availability])).toEqual([]));
  it('does not invent recovery without an observed open incident', () => expect(incidentTransitions(success, [])).toEqual([]));
  it('closes a failure on a valid JSON response', () => expect(incidentTransitions(success, [availability])[0]).toMatchObject({ action: 'close', event: 'recovery', resolution: 'check_recovered' }));
  it('never emits a schema event without an accepted baseline', () => expect(incidentTransitions({ ...changed, hasBaseline: false }, [])).toEqual([]));
  it('opens a schema incident for recorded differences', () => expect(incidentTransitions(changed, [])[0]).toMatchObject({ action: 'open', event: 'schema_changed' }));
  it('suppresses identical schema differences', () => expect(incidentTransitions(changed, [schema])).toEqual([]));
  it('records a genuinely different observed deviation within the same incident', () => expect(incidentTransitions({ ...changed, changes: [{ ...change, currentTypes: ['null'] }] }, [schema])[0]).toMatchObject({ action: 'update', event: 'schema_changed' }));
  it('does not resolve schema state from a failed or baseline-missing check', () => {
    expect(incidentTransitions(failure, [availability, schema])).toEqual([]);
    expect(incidentTransitions({ ...success, hasBaseline: false }, [schema])).toEqual([]);
  });
  it('can report availability recovery and a schema deviation in one response', () => expect(incidentTransitions(changed, [availability]).map(item => item.event)).toEqual(['recovery', 'schema_changed']));
  it('calls matching samples schema restoration, not guaranteed compatibility', () => expect(incidentTransitions(success, [schema])[0]).toMatchObject({ event: 'schema_restored', resolution: 'sample_matches_baseline' }));
  it('canonicalizes field/type ordering for deterministic deduplication', () => {
    const other = { ...change, path: '$.email', previousTypes: ['null', 'string'] };
    expect(schemaFingerprint([change, other])).toBe(schemaFingerprint([{ ...other, previousTypes: ['string', 'null', 'null'] }, change]));
  });
});

describe('safe local email policy and templates', () => {
  it('renders actual failure metadata with no fabricated status or delivery claim', () => {
    const message = notificationMessage(emailJob());
    expect(message.to).toBe(`watchtower+${emailOwner}@example.test`);
    expect(message.text).toContain('HTTP status: Unavailable'); expect(message.text).toContain('8000 ms'); expect(message.text).toContain('Error category: timeout');
    expect(message.text).toContain('not proof of delivery'); expect(message.text).toContain('2026-10-25T16:00:00.000Z');
  });
  it('sanitizes headers and limits relevant structural differences', () => {
    const job = emailJob(); job.event.endpointName = 'Test\r\nBcc: external@example.com'; job.event.kind = 'schema_changed';
    job.event.checkResult.schemaChanges = Array.from({ length: 25 }, (_, index) => ({ id: String(index), checkResultId: job.event.checkResultId, ...change, changeType: 'type_changed' as const }));
    const message = notificationMessage(job);
    expect(message.subject).not.toMatch(/[\r\n]/); expect(message.text).toContain('$.id: type_changed (number -> string)'); expect(message.text).toContain('5 additional differences');
    expect(message.messageId).toBe(`<${job.eventId}@api-watchtower.test>`);
    for (const difference of job.event.checkResult.schemaChanges) {
      difference.path = `$.${'😀'.repeat(1000)}`;
      difference.previousTypes = ['array', 'boolean', 'null', 'number', 'object', 'string'];
      difference.currentTypes = ['array', 'null', 'number', 'object', 'string'];
    }
    const bounded = notificationMessage(job);
    expect(Buffer.byteLength(bounded.text)).toBeLessThanOrEqual(16_384);
    expect(bounded.text).toContain('…');
  });
  it('rejects a recipient identifier that is not a database UUID', () => expect(() => mailpitRecipient('external@example.com')).toThrow());
  it('uses deterministic bounded backoff', () => expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([30000, 60000, 120000, 240000, 300000]));
  const valid = { NODE_ENV: 'development', ENABLE_EMAIL_DISPATCHER: 'true', EMAIL_DELIVERY_MODE: 'mailpit', DATABASE_URL: 'postgresql://fixture:placeholder@127.0.0.1:5432/watchtower_dev?schema=public' };
  it('requires separate explicit opt-in', () => {
    expect(emailDispatcherConnectionString(valid)).toBe(valid.DATABASE_URL);
    expect(() => emailDispatcherConnectionString({ ...valid, ENABLE_EMAIL_DISPATCHER: 'false' })).toThrow();
  });
  it.each([
    { ...valid, NODE_ENV: 'production' }, { ...valid, EMAIL_DELIVERY_MODE: 'smtp' }, { ...valid, MAILPIT_SMTP_HOST: 'smtp.example.com' },
    { ...valid, MAILPIT_SMTP_PORT: '587' }, { ...valid, DATABASE_URL: 'postgresql://fixture:placeholder@remote.example/watchtower_dev' },
    { ...valid, DATABASE_URL: 'postgresql://fixture:placeholder@127.0.0.1/watchtower_test' },
  ])('rejects nonlocal or unconfirmed dispatcher configuration case %#', environment => expect(() => emailDispatcherConnectionString(environment)).toThrow());
});
