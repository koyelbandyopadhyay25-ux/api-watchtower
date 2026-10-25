import express, { type Request, type RequestHandler } from 'express';
import { parse, serialize } from 'cookie';
import { rateLimit } from 'express-rate-limit';
import { AuthError, equalToken, SESSION_SECONDS, type AuthService } from './auth-service.js';

const cookieName = 'watchtower_session';
export function sessionCookie(request: Request): string | undefined {
  const header = request.headers.cookie ?? '';
  if (header.length > 4096 || header.split(';').filter(part => part.trim().startsWith(`${cookieName}=`)).length > 1) return undefined;
  return parse(header)[cookieName];
}
export function requireAuthentication(authentication?: AuthService): RequestHandler {
  return async (request, response, next) => {
    try {
      if (!authentication) throw new AuthError(401, 'authentication_required');
      const context = await authentication.authenticate(sessionCookie(request));
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !equalToken(request.header('X-CSRF-Token'), context.csrfToken)) throw new AuthError(403, 'csrf_invalid');
      response.locals.authentication = context;
      next();
    } catch (error) { next(error); }
  };
}

export function authRoutes(authentication: AuthService, environment: NodeJS.ProcessEnv) {
  const router = express.Router();
  // These routes are mounted AFTER the unchanged loopback, Origin and custom-header guard.
  // Pre-login writes require an Origin as well: JSON + custom header cannot be submitted by a cross-origin HTML form.
  router.use((request, _response, next) => {
    if (request.method === 'POST' && !request.headers.origin) next(new AuthError(403, 'origin_required'));
    else next();
  });
  const limiter = (limit: number) => rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'authentication_rate_limited' } });
  const secure = !(environment.NODE_ENV === 'development' && environment.AUTH_COOKIE_SECURE === 'false');
  const attributes = { httpOnly: true, secure, sameSite: 'strict' as const, path: '/api' };
  router.post('/register', limiter(5), async (request, response) => {
    response.status(202).json(await authentication.register(request.body));
  });
  router.post('/login', limiter(10), async (request, response) => {
    const session = await authentication.login(request.body, sessionCookie(request));
    response.setHeader('Set-Cookie', serialize(cookieName, session.token, { ...attributes, maxAge: SESSION_SECONDS, expires: session.expiresAt }));
    response.json({ user: session.user, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
  });
  router.get('/session', requireAuthentication(authentication), (_request, response) => {
    response.json(response.locals.authentication);
  });
  router.post('/logout', requireAuthentication(authentication), async (request, response) => {
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).length) throw new AuthError(400, 'invalid_request_body');
    await authentication.logout(sessionCookie(request));
    response.setHeader('Set-Cookie', serialize(cookieName, '', { ...attributes, maxAge: 0, expires: new Date(0) }));
    response.json({ ok: true });
  });
  return router;
}
