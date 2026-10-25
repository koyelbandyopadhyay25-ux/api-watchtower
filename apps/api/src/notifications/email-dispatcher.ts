import { setTimeout as delay } from 'node:timers/promises';
import type { OutboxRepository, EmailJob } from './outbox-repository.js';
import { EMAIL_LIMITS, EmailDeliveryError } from './delivery-policy.js';

export function createEmailDispatcher(repository: OutboxRepository, send: (job: EmailJob) => Promise<void>,
  log: (event: { event: string; eventId?: string }) => void, pollMs: number = EMAIL_LIMITS.pollMs) {
  let ticking = false;
  async function tick(signal?: AbortSignal) {
    if (ticking || signal?.aborted) return;
    ticking = true;
    async function slot() {
      if (signal?.aborted) return;
      let job: EmailJob | null;
      try { job = await repository.claim(); }
      catch { log({ event: 'email_claim_failed' }); return; }
      if (!job) return;
      try {
        if (!await repository.allowed(job.eventId, job.leaseToken!)) await repository.complete(job, { kind: 'cancelled' });
        else {
          try { await send(job); }
          catch (failure) {
            if (!(failure instanceof EmailDeliveryError)) throw failure;
            await repository.complete(job, { kind: 'failed', code: failure.code, retryable: failure.retryable });
            log({ event: 'email_attempt_failed', eventId: job.eventId }); return;
          }
          const saved = await repository.complete(job, { kind: 'accepted' });
          log({ event: saved ? 'email_smtp_accepted' : 'email_ack_lost', eventId: job.eventId });
        }
      } catch { log({ event: 'email_attempt_unconfirmed', eventId: job.eventId }); /* Lease recovery preserves uncertainty. */ }
    }
    try { await Promise.all(Array.from({ length: EMAIL_LIMITS.concurrency }, slot)); }
    finally { ticking = false; }
  }
  async function run(signal: AbortSignal) {
    while (!signal.aborted) {
      await tick(signal); // Drain admitted, bounded sends on graceful shutdown.
      if (!signal.aborted) { try { await delay(pollMs, undefined, { signal }); } catch { if (!signal.aborted) throw new Error('Email dispatcher wait failed.'); } }
    }
  }
  return { tick, run };
}
