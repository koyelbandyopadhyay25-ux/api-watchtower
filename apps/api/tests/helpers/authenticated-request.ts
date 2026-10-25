import supertest from 'supertest';
import type { Express } from 'express';
import type { AuthService } from '../../src/auth/auth-service.js';

export const testUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const testCsrf = 'c'.repeat(43);
// A dependency double for old route validation tests; never imported by application code.
export const testAuthentication = {
  authenticate: async () => ({ user: { id: testUserId, email: 'fixture@example.test' }, csrfToken: testCsrf, expiresAt: new Date('2099-01-01') }),
} as unknown as AuthService;
export function authenticatedRequest(app: Express) { return supertest.agent(app).set('X-CSRF-Token', testCsrf); }
