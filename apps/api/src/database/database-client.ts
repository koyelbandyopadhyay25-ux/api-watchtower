import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/** No global connection: callers own the client and must disconnect in finally. */
export function createDatabaseClient(connectionString: string): PrismaClient {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('A direct PostgreSQL connection URL is required.');
  }
  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  });
  // Do not enable query/error logging: driver messages can contain sensitive data.
  return new PrismaClient({ adapter, log: [] });
}
