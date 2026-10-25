import type { PrismaClient } from '../generated/prisma/client.js';
import { databaseOperation } from '../database/database-errors.js';

export function createAuthRepository(client: PrismaClient) {
  return {
    createUser: (email: string, passwordHash: string) => databaseOperation(() => client.user.create({ data: { email, passwordHash } })),
    findUser: (email: string) => databaseOperation(() => client.user.findUnique({ where: { email } })),
    createSession: (data: { tokenHash: string; userId: string; csrfToken: string; createdAt: Date; expiresAt: Date }) =>
      databaseOperation(() => client.session.create({ data })),
    getSession: (tokenHash: string) => databaseOperation(() => client.session.findUnique({ where: { tokenHash }, include: { user: { select: { id: true, email: true } } } })),
    revokeSession: (tokenHash: string) => databaseOperation(() => client.session.deleteMany({ where: { tokenHash } })),
  };
}
export type AuthRepository = ReturnType<typeof createAuthRepository>;
