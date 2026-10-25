import { Prisma } from '../generated/prisma/client.js';

export type DatabaseErrorCode = 'not_found' | 'conflict' | 'unavailable' | 'operation_failed';

export class DatabaseError extends Error {
  constructor(public readonly code: DatabaseErrorCode) {
    super(`Database operation failed (${code}).`);
    this.name = 'DatabaseError';
  }
}

/** Deliberately omit the original exception, SQL, credentials, and supplied data. */
export async function databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') throw new DatabaseError('not_found');
      if (['P2002', 'P2003'].includes(error.code)) throw new DatabaseError('conflict');
      if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code)) {
        throw new DatabaseError('unavailable');
      }
    }
    if (error instanceof Prisma.PrismaClientInitializationError) {
      throw new DatabaseError('unavailable');
    }
    throw new DatabaseError('operation_failed');
  }
}
