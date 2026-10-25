import { createHash } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';

export class CheckCoordinationError extends Error {
  constructor(readonly reason: 'endpoint_busy' | 'capacity') { super(reason); }
}

export function endpointLockKey(id: string): string {
  return createHash('sha256').update(`api-watchtower:endpoint:${id.toLowerCase()}`).digest().readBigInt64BE().toString();
}

/** All callers use these same transaction-scoped keys, across API/worker processes. */
export async function acquireCheckLocks(transaction: Prisma.TransactionClient, endpointId: string, capacity: boolean): Promise<void> {
  const endpoint = await transaction.$queryRaw<{ acquired: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(${endpointLockKey(endpointId)}::bigint) AS acquired
  `;
  if (!endpoint[0]?.acquired) throw new CheckCoordinationError('endpoint_busy');
  if (!capacity) return;
  // The two-int key space is separate from the bigint endpoint key space.
  for (let slot = 0; slot < 3; slot++) {
    const result = await transaction.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(731421::int, ${slot}::int) AS acquired
    `;
    if (result[0]?.acquired) return;
  }
  throw new CheckCoordinationError('capacity');
}
