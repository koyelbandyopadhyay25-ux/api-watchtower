import express, { type ErrorRequestHandler } from 'express';
import { DatabaseError } from '../database/database-errors.js';
import { FetchBusyError } from './safe-json-fetcher.js';
import { MonitoringError, type MonitoringService } from './monitoring-service.js';
import { UrlPolicyError } from './url-policy.js';
import { CheckCoordinationError } from '../database/check-coordination.js';
import { isMonitoringInterval } from '../scheduling/schedule-policy.js';
import { AuthError, type AuthService } from '../auth/auth-service.js';
import { authRoutes, requireAuthentication } from '../auth/auth-routes.js';

export function localManagementEnabled(environment: NodeJS.ProcessEnv): boolean {
  return environment.NODE_ENV === 'development' && environment.ENABLE_LOCAL_MANAGEMENT === 'true';
}

export function managementRoutes(service: MonitoringService, apiPort = '3001', authentication?: AuthService, environment: NodeJS.ProcessEnv = {}) {
  const router = express.Router();
  router.use((request, response, next) => {
    const peer = request.socket.remoteAddress;
    const host = request.headers.host ?? '';
    let hostname = '';
    try { hostname = new URL(`http://${request.headers.host ?? ''}`).hostname; } catch { /* Reject below. */ }
    const origin = request.headers.origin;
    const allowedOrigins = ['localhost', '127.0.0.1'].flatMap(host =>
      ['5173', apiPort].map(port => `http://${host}:${port}`));
    if (!/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i.test(host) ||
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '') ||
        !['localhost', '127.0.0.1'].includes(hostname) ||
        (origin !== undefined && !allowedOrigins.includes(origin)) ||
        request.header('x-watchtower-local') !== '1' ||
        Object.keys(request.headers).some(header => header === 'forwarded' || header.startsWith('x-forwarded-'))) {
      response.status(403).json({ error: 'local_management_only' });
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(express.json({ limit: '8kb' }));
  router.use((request, response, next) => {
    if (['POST', 'PUT'].includes(request.method) && !request.is('application/json')) {
      response.status(415).json({ error: 'application_json_required' });
      return;
    }
    next();
  });
  if (authentication) router.use('/auth', authRoutes(authentication, environment));
  router.use('/endpoints', requireAuthentication(authentication));
  router.param('id', (request, _response, next, id: string) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      next(new MonitoringError(400, 'invalid_endpoint_id'));
      return;
    }
    // UUID spelling must not let one endpoint acquire multiple in-process locks.
    request.params.id = id.toLowerCase();
    next();
  });

  function limit(value: unknown): number {
    if (value === undefined) return 50;
    if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) {
      throw new MonitoringError(400, 'limit_must_be_1_to_100');
    }
    return Number(value);
  }
  function body(value: unknown, keys: string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
      throw new MonitoringError(400, 'invalid_request_body');
    }
    return value as Record<string, unknown>;
  }

  router.post('/endpoints', async (request, response) => {
    const input = body(request.body, ['name', 'url']);
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100 || typeof input.url !== 'string') {
      throw new MonitoringError(400, 'name_and_url_required');
    }
    response.status(201).json(await service.register({ name: input.name, url: input.url }, response.locals.authentication.user.id));
  });
  router.get('/endpoints', async (request, response) => {
    response.json({ endpoints: await service.list(limit(request.query.limit), response.locals.authentication.user.id) });
  });
  router.get('/endpoints/:id', async (request, response) => { response.json(await service.get(request.params.id!, response.locals.authentication.user.id)); });
  router.post('/endpoints/:id/checks', async (request, response) => {
    body(request.body, []);
    response.status(201).json(await service.check(request.params.id!, response.locals.authentication.user.id));
  });
  router.get('/endpoints/:id/checks', async (request, response) => {
    response.json({ checks: await service.history(request.params.id!, limit(request.query.limit), response.locals.authentication.user.id) });
  });
  router.put('/endpoints/:id/baseline', async (request, response) => {
    const input = body(request.body, ['accept', 'expectedUpdatedAt']);
    if (input.accept !== true || typeof input.expectedUpdatedAt !== 'string' ||
        !Number.isFinite(Date.parse(input.expectedUpdatedAt)) || new Date(input.expectedUpdatedAt).toISOString() !== input.expectedUpdatedAt) {
      throw new MonitoringError(400, 'explicit_acceptance_and_updated_at_required');
    }
    response.json(await service.acceptBaseline(request.params.id!, input.expectedUpdatedAt, response.locals.authentication.user.id));
  });

  router.get('/endpoints/:id/schedule', async (request, response) => {
    response.json(await service.schedule(request.params.id!, response.locals.authentication.user.id));
  });
  router.put('/endpoints/:id/schedule', async (request, response) => {
    const input = body(request.body, ['enabled', 'intervalMinutes']);
    if (typeof input.enabled !== 'boolean' || !isMonitoringInterval(input.intervalMinutes)) {
      throw new MonitoringError(400, 'enabled_and_supported_interval_required');
    }
    response.json(await service.configureSchedule(request.params.id!, input.enabled, input.intervalMinutes, response.locals.authentication.user.id));
  });
  router.get('/endpoints/:id/scheduled-checks', async (request, response) => {
    response.json({ runs: await service.scheduledHistory(request.params.id!, limit(request.query.limit), response.locals.authentication.user.id) });
  });

  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof AuthError) response.status(error.status).json({ error: error.code });
    else if (error instanceof MonitoringError) response.status(error.status).json({ error: error.code });
    else if (error instanceof CheckCoordinationError) response.status(error.reason === 'capacity' ? 429 : 409)
      .json({ error: error.reason === 'capacity' ? 'check_capacity_reached' : 'check_already_running' });
    else if (error instanceof UrlPolicyError) response.status(400).json({ error: 'url_not_allowed' });
    else if (error instanceof FetchBusyError) response.status(429).json({ error: 'check_capacity_reached' });
    else if (error instanceof DatabaseError) {
      response.status(error.code === 'conflict' ? 409 : 503).json({ error: `database_${error.code}` });
    } else if (error instanceof SyntaxError || (error as { type?: string })?.type === 'entity.parse.failed') {
      response.status(400).json({ error: 'invalid_json_body' });
    } else if ((error as { type?: string })?.type === 'entity.too.large') response.status(413).json({ error: 'request_too_large' });
    else response.status(500).json({ error: 'internal_error' });
  };
  router.use(handleError);
  return router;
}
