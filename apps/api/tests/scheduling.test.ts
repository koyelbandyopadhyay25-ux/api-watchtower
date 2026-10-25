import { describe, expect, it, vi } from 'vitest';
import { isDue, isMonitoringInterval, nextScheduledTime } from '../src/scheduling/schedule-policy.js';
import { endpointLockKey, CheckCoordinationError } from '../src/database/check-coordination.js';
import { workerConnectionString } from '../src/worker/worker-config.js';
import { createMonitoringWorker, type WorkerEvent } from '../src/worker/monitoring-worker.js';
import type { createMonitoringRepository } from '../src/database/monitoring-repository.js';
import type { MonitoringService } from '../src/monitoring/monitoring-service.js';

describe('schedule policy with controlled clocks', () => {
  const due = new Date('2026-10-25T12:00:00.000Z');
  it.each([5, 15, 30, 60])('accepts interval %i', value => expect(isMonitoringInterval(value)).toBe(true));
  it.each([0, 1, 10, 120, '5', null])('rejects unsupported interval %s', value => expect(isMonitoringInterval(value)).toBe(false));
  it('distinguishes disabled, absent, due, and not-yet-due states', () => {
    expect(isDue(false, due, due)).toBe(false);
    expect(isDue(true, null, due)).toBe(false);
    expect(isDue(true, due, new Date(due.getTime() - 1))).toBe(false);
    expect(isDue(true, due, due)).toBe(true);
    expect(isDue(true, due, new Date(due.getTime() + 1))).toBe(true);
  });
  it('preserves cadence after a normal check', () => {
    expect(nextScheduledTime(due, 5, new Date('2026-10-25T12:00:08Z')).toISOString()).toBe('2026-10-25T12:05:00.000Z');
  });
  it('skips missed slots after downtime without a catch-up storm', () => {
    expect(nextScheduledTime(due, 15, new Date('2026-10-25T13:07:00Z')).toISOString()).toBe('2026-10-25T13:15:00.000Z');
  });
  it('advances past an exact boundary instead of becoming immediately due again', () => {
    expect(nextScheduledTime(due, 30, new Date('2026-10-25T12:30:00Z')).toISOString()).toBe('2026-10-25T13:00:00.000Z');
  });
  it('normalizes endpoint lock IDs and keeps endpoint keys distinct', () => {
    expect(endpointLockKey('AAA')).toBe(endpointLockKey('aaa'));
    expect(endpointLockKey('aaa')).not.toBe(endpointLockKey('bbb'));
  });
});

describe('worker opt-in', () => {
  const valid = { NODE_ENV: 'development', ENABLE_SCHEDULER_WORKER: 'true', DATABASE_URL: 'postgresql://user:placeholder@127.0.0.1:5432/watchtower_dev?schema=public' };
  it('accepts explicit local development configuration', () => expect(workerConnectionString(valid)).toBe(valid.DATABASE_URL));
  it.each([
    { ...valid, ENABLE_SCHEDULER_WORKER: undefined }, { ...valid, ENABLE_SCHEDULER_WORKER: 'false' },
    { ...valid, NODE_ENV: 'production' }, { ...valid, DATABASE_URL: undefined },
    { ...valid, DATABASE_URL: 'postgresql://user:placeholder@example.com/watchtower_dev' },
    { ...valid, DATABASE_URL: 'postgresql://user:placeholder@localhost/production' },
    { ...valid, DATABASE_URL: 'postgresql://user:placeholder@localhost/watchtower_test' },
  ])('rejects disabled, remote, production, or unconfirmed test settings (%j)', config => {
    expect(() => workerConnectionString(config)).toThrow();
  });
});

function harness() {
  let clock = 0;
  const dueSchedules = vi.fn(async () => [{ endpointId: 'one' }, { endpointId: 'two' }]);
  const checkScheduled = vi.fn(async (id: string) => ({ check: { id: `check-${id}`, outcome: 'success' } }));
  const events: WorkerEvent[] = [];
  const repository = { dueSchedules } as unknown as Pick<ReturnType<typeof createMonitoringRepository>, 'dueSchedules'>;
  const service = { checkScheduled } as unknown as Pick<MonitoringService, 'checkScheduled'>;
  const worker = createMonitoringWorker(repository, service, event => events.push(event), { now: () => clock, pollMs: 5, retryMs: 30 });
  return { worker, dueSchedules, checkScheduled, events, advance: (ms: number) => { clock += ms; } };
}

describe('worker polling and failure isolation', () => {
  it('checks a bounded batch and logs only actual saved results', async () => {
    const { worker, dueSchedules, checkScheduled, events } = harness();
    await worker.tick();
    expect(dueSchedules).toHaveBeenCalledWith(3, []);
    expect(checkScheduled).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      { event: 'scheduled_check_saved', endpointId: 'one', checkId: 'check-one', outcome: 'success' },
      { event: 'scheduled_check_saved', endpointId: 'two', checkId: 'check-two', outcome: 'success' },
    ]);
  });
  it('does not overlap polling ticks', async () => {
    const { worker, dueSchedules } = harness();
    let finish!: (value: { endpointId: string }[]) => void;
    dueSchedules.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = worker.tick();
    await worker.tick();
    expect(dueSchedules).toHaveBeenCalledTimes(1);
    finish([]);
    await pending;
  });
  it('isolates a failed endpoint, backs it off, and recovers on a controlled clock', async () => {
    const { worker, checkScheduled, dueSchedules, events, advance } = harness();
    checkScheduled.mockRejectedValueOnce(new Error('secret response body'));
    await worker.tick();
    expect(events.some(event => event.event === 'scheduled_check_saved' && event.endpointId === 'two')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('secret');
    await worker.tick();
    expect(dueSchedules).toHaveBeenLastCalledWith(3, ['one']);
    expect(checkScheduled.mock.calls.filter(([id]) => id === 'one')).toHaveLength(1);
    advance(30);
    await worker.tick();
    expect(checkScheduled.mock.calls.filter(([id]) => id === 'one')).toHaveLength(2);
  });
  it('treats a competing worker or manual owner as a skip, not a fabricated failure', async () => {
    const { worker, checkScheduled, events } = harness();
    checkScheduled.mockRejectedValueOnce(new CheckCoordinationError('endpoint_busy'));
    await worker.tick();
    expect(events[0]).toEqual({ event: 'scheduled_check_skipped', endpointId: 'one' });
  });
  it('recovers after a poll/database error', async () => {
    const { worker, dueSchedules, checkScheduled, events } = harness();
    dueSchedules.mockRejectedValueOnce(new Error('private database details'));
    await worker.tick();
    await worker.tick();
    expect(events[0]).toEqual({ event: 'worker_poll_failed' });
    expect(checkScheduled).toHaveBeenCalledTimes(2);
  });
  it('stops without polling when already aborted', async () => {
    const { worker, dueSchedules } = harness();
    const stop = new AbortController(); stop.abort();
    await worker.run(stop.signal);
    expect(dueSchedules).not.toHaveBeenCalled();
  });
  it('drains started work and does not start remaining checks after shutdown', async () => {
    const { worker, checkScheduled } = harness();
    const stop = new AbortController();
    checkScheduled.mockImplementation(async id => { stop.abort(); return { check: { id, outcome: 'success' } }; });
    await worker.run(stop.signal);
    expect(checkScheduled).toHaveBeenCalledTimes(1);
  });
});
