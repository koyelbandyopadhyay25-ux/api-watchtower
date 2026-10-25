export const EMAIL_LIMITS = { concurrency: 2, maxAttempts: 5, leaseMs: 60_000, sendMs: 8_000, pollMs: 2_000 } as const;
export function retryDelayMs(attempt: number) {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > EMAIL_LIMITS.maxAttempts) throw new Error('Invalid email attempt number.');
  return Math.min(300_000, 30_000 * 2 ** (attempt - 1));
}
export class EmailDeliveryError extends Error {
  constructor(readonly code: 'smtp_timeout' | 'smtp_unavailable' | 'smtp_rejected' | 'invalid_message', readonly retryable: boolean) { super(code); }
}
export type DeliveryResult = { kind: 'accepted' } | { kind: 'cancelled' } | { kind: 'failed'; code: string; retryable: boolean };
