import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { DatabaseError } from '../../src/database/database-errors.js';
import { createAuthService } from '../../src/auth/auth-service.js';
import type { AuthRepository } from '../../src/auth/auth-repository.js';

export function authFixture() {
  type User = { id: string; email: string; passwordHash: string; createdAt: Date };
  type Session = { tokenHash: string; userId: string; csrfToken: string; createdAt: Date; expiresAt: Date };
  const users = new Map<string, User>();
  const sessions = new Map<string, Session>();
  let time = new Date('2026-10-25T15:00:00Z');
  const repository = {
    createUser: vi.fn(async (email: string, passwordHash: string) => {
      if (users.has(email)) throw new DatabaseError('conflict');
      const user = { id: randomUUID(), email, passwordHash, createdAt: time }; users.set(email, user); return user;
    }),
    findUser: vi.fn(async (email: string) => users.get(email) ?? null),
    createSession: vi.fn(async (data: Session) => { sessions.set(data.tokenHash, data); return data; }),
    getSession: vi.fn(async (hash: string) => {
      const session = sessions.get(hash); if (!session) return null;
      const user = [...users.values()].find(user => user.id === session.userId)!;
      return { ...session, user: { id: user.id, email: user.email } };
    }),
    revokeSession: vi.fn(async (hash: string) => ({ count: Number(sessions.delete(hash)) })),
  } satisfies AuthRepository;
  return { users, sessions, repository, service: createAuthService(repository, () => time), advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}
