import { vi } from 'vitest';
import type { CheckResult, Endpoint, SchemaChange } from '../src/api/types';

export const endpointId = '11111111-1111-4111-8111-111111111111';
export const initialTimestamp = '2026-10-25T10:00:00.000Z';
export const nextTimestamp = '2026-10-25T11:00:00.000Z';
export function endpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return { id: endpointId, name: 'Todo API', url: 'https://jsonplaceholder.typicode.com/todos/1', baselineSchema: null,
    createdAt: initialTimestamp, updatedAt: initialTimestamp, ...overrides };
}
export function check(overrides: Partial<CheckResult> = {}): CheckResult {
  return { id: 'check-1', endpointId, httpStatus: 200, responseTimeMs: 42, outcome: 'success', errorCode: null,
    checkedAt: nextTimestamp, schemaChanges: [], ...overrides };
}
export const changes: SchemaChange[] = [
  { id: 'change-a', checkResultId: 'changed', path: '$.email', changeType: 'added', previousTypes: [], currentTypes: ['string'] },
  { id: 'change-b', checkResultId: 'changed', path: '$.legacy', changeType: 'removed', previousTypes: ['boolean'], currentTypes: [] },
  { id: 'change-c', checkResultId: 'changed', path: '$.products[].price', changeType: 'type_changed', previousTypes: ['number'], currentTypes: ['null', 'string'] },
];

export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Mutable simulated API state exists only in tests; the running UI has no fixtures. */
export function mockApi(options: { endpoints?: Endpoint[]; checks?: Record<string, CheckResult[]> } = {}) {
  const state = {
    endpoints: options.endpoints ?? [endpoint()],
    checks: options.checks ?? {} as Record<string, CheckResult[]>,
    failedHistory: new Set<string>(),
    nextCheck: check(),
    baselineError: null as string | null,
    calls: [] as { path: string; method: string; body: Record<string, unknown> | null }[],
  };
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost:5173');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    state.calls.push({ path: url.pathname, method, body });
    if (url.pathname === '/api/endpoints') {
      if (method === 'GET') return json({ endpoints: state.endpoints });
      const created = endpoint({ id: '22222222-2222-4222-8222-222222222222', name: String(body?.name), url: String(body?.url) });
      state.endpoints = [...state.endpoints, created];
      return json(created, 201);
    }
    const parts = url.pathname.split('/');
    const id = parts[3]!;
    const saved = state.endpoints.find(item => item.id === id);
    if (!saved) return json({ error: 'endpoint_not_found' }, 404);
    if (parts[4] === 'checks') {
      if (method === 'GET') return state.failedHistory.has(id) ? json({ error: 'database_unavailable' }, 503) : json({ checks: (state.checks[id] ?? []).slice(0, Number(url.searchParams.get('limit') ?? 100)) });
      const recorded = { ...state.nextCheck, endpointId: id };
      state.checks[id] = [recorded, ...(state.checks[id] ?? [])];
      return json({ check: recorded, comparison: saved.baselineSchema === null ? 'baseline_missing' : 'compared' }, 201);
    }
    if (parts[4] === 'baseline') {
      if (state.baselineError) {
        const code = state.baselineError;
        state.baselineError = null;
        if (code === 'stale_baseline_acceptance') saved.updatedAt = nextTimestamp;
        if (code === 'baseline_capture_failed_check_saved') state.checks[id] = [check({ id: 'failed-capture', outcome: 'network_error', httpStatus: null, errorCode: 'timeout' })];
        return json({ error: code }, code === 'baseline_capture_failed_check_saved' ? 422 : 409);
      }
      saved.baselineSchema = { types: ['object'], properties: { id: { types: ['number'] } } };
      saved.updatedAt = nextTimestamp;
      const captured = check({ id: 'capture-check', endpointId: id });
      state.checks[id] = [captured, ...(state.checks[id] ?? [])];
      return json({ endpoint: saved, check: captured, comparison: 'baseline_missing' });
    }
    return json(saved);
  });
  vi.stubGlobal('fetch', fetch);
  return { state, fetch };
}
