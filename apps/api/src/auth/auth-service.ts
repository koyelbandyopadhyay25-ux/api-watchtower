import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import type { AuthRepository } from './auth-repository.js';
import { DatabaseError } from '../database/database-errors.js';

export class AuthError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export const SESSION_SECONDS = 8 * 60 * 60;
const parameters = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const sessionHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function validToken(token: unknown): token is string { return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token); }
export function equalToken(a: unknown, b: string): boolean {
  return validToken(a) && validToken(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function credentials(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['email', 'password'].includes(key))) throw new AuthError(400, 'invalid_credentials_format');
  const { email, password } = input as Record<string, unknown>;
  if (typeof email !== 'string' || email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email.trim()) ||
    typeof password !== 'string' || [...password].length < 12 || [...password].length > 128 || Buffer.byteLength(password) > 512) throw new AuthError(400, 'invalid_credentials_format');
  return { email: email.trim().toLowerCase(), password };
}

export function createAuthService(repository: AuthRepository, now = () => new Date()) {
  let hashing = 0;
  // Unknown users still perform a real verification, using matching cost parameters.
  let dummy: Promise<string> | undefined;
  async function bounded<T>(operation: () => Promise<T>): Promise<T> {
    if (hashing >= 2) throw new AuthError(429, 'authentication_busy');
    hashing++;
    try { return await operation(); } finally { hashing--; }
  }
  return {
    async register(input: unknown) {
      const { email, password } = credentials(input);
      await bounded(async () => {
        const hash = await argon2.hash(password, parameters);
        try { await repository.createUser(email, hash); }
        catch (error) { if (!(error instanceof DatabaseError && error.code === 'conflict')) throw error; }
      });
      // Identical response for a duplicate address. Never modify its password.
      return { message: 'Registration request processed. You can now try signing in.' };
    },
    async login(input: unknown, previousToken?: string) {
      const { email, password } = credentials(input);
      const user = await bounded(async () => {
        const found = await repository.findUser(email);
        dummy ??= argon2.hash(randomBytes(32), parameters);
        const fallback = await dummy;
        const verified = await argon2.verify(found?.passwordHash ?? fallback, password);
        if (!found || !verified) throw new AuthError(401, 'invalid_credentials');
        return found;
      });
      const token = randomBytes(32).toString('base64url');
      const csrfToken = randomBytes(32).toString('base64url');
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + SESSION_SECONDS * 1000);
      // Revoke the presented session before issuing a fresh random identifier.
      if (validToken(previousToken)) await repository.revokeSession(sessionHash(previousToken));
      await repository.createSession({ tokenHash: sessionHash(token), userId: user.id, csrfToken, createdAt, expiresAt });
      return { token, csrfToken, expiresAt, user: { id: user.id, email: user.email } };
    },
    async authenticate(token: unknown) {
      if (!validToken(token)) throw new AuthError(401, 'authentication_required');
      const session = await repository.getSession(sessionHash(token));
      if (!session || session.expiresAt.getTime() <= now().getTime()) throw new AuthError(401, 'authentication_required');
      return { user: session.user, csrfToken: session.csrfToken, expiresAt: session.expiresAt };
    },
    async logout(token: unknown) {
      if (validToken(token)) await repository.revokeSession(sessionHash(token));
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
