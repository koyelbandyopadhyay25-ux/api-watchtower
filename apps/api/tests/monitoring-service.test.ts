import { describe, expect, it, vi } from 'vitest';
import { inferJsonSchema, compareInferredSchemas, compareJsonSchema } from '../src/schema-comparison/compare-json-schema.js';
import { createMonitoringService } from '../src/monitoring/monitoring-service.js';
import type { createMonitoringRepository } from '../src/database/monitoring-repository.js';
import type { JsonValue } from '../src/schema-comparison/schema-types.js';

function fixture(baseline: JsonValue | undefined = undefined) {
  const endpoint = { id: 'endpoint', url: 'https://jsonplaceholder.typicode.com/todos/1', updatedAt: new Date('2026-01-01'),
    baselineSchema: baseline === undefined ? null : inferJsonSchema(baseline) };
  const repository = {
    getEndpoint: vi.fn(async () => endpoint), recordCheck: vi.fn(async input => ({ id: 'check', ...input })),
    acceptBaseline: vi.fn(async () => endpoint), createEndpoint: vi.fn(), listEndpoints: vi.fn(), listCheckResults: vi.fn(),
    runExclusive: vi.fn(async (_id: string, operation: (store: unknown, signal: AbortSignal) => Promise<unknown>) => operation(repository, new AbortController().signal)),
  };
  const fetchJson = vi.fn(async () => ({ ok: true as const, value: { id: '1', added: true }, httpStatus: 200, responseTimeMs: 12 }));
  const service = createMonitoringService(repository as unknown as ReturnType<typeof createMonitoringRepository>, fetchJson);
  return { repository, fetchJson, service, endpoint };
}

describe('monitoring workflow', () => {
  it('does not automatically create a baseline on the first successful check', async () => {
    const { service, repository } = fixture();
    const result = await service.check('endpoint');
    expect(result.comparison).toBe('baseline_missing');
    expect(repository.recordCheck).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success', httpStatus: 200, responseTimeMs: 12, checkedAt: expect.any(Date), schemaChanges: [] }));
    expect(repository.acceptBaseline).not.toHaveBeenCalled();
  });

  it('persists additions, removals, and type changes against the accepted baseline', async () => {
    const { service, repository } = fixture({ id: 1, removed: 'value' });
    await service.check('endpoint');
    expect(repository.recordCheck).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'schema_changed', schemaChanges: [
      { path: '$.added', changeType: 'added', previousTypes: [], currentTypes: ['boolean'] },
      { path: '$.id', changeType: 'type_changed', previousTypes: ['number'], currentTypes: ['string'] },
      { path: '$.removed', changeType: 'removed', previousTypes: ['string'], currentTypes: [] },
    ] }));
    expect(repository.acceptBaseline).not.toHaveBeenCalled();
  });

  it('captures structure only when explicitly accepted with a fresh timestamp', async () => {
    const { service, repository, endpoint } = fixture();
    await service.acceptBaseline('endpoint', endpoint.updatedAt.toISOString());
    expect(repository.acceptBaseline).toHaveBeenCalledWith('endpoint', endpoint.updatedAt,
      { types: ['object'], properties: { added: { types: ['boolean'] }, id: { types: ['string'] } } });
  });

  it('rejects stale acceptance before fetching', async () => {
    const { service, fetchJson } = fixture();
    await expect(service.acceptBaseline('endpoint', new Date(0).toISOString())).rejects.toMatchObject({ status: 409 });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('preserves safe failure metadata and refuses acceptance of failed captures', async () => {
    const { repository, endpoint } = fixture();
    const service = createMonitoringService(repository as unknown as ReturnType<typeof createMonitoringRepository>,
      async () => ({ ok: false, httpStatus: null, responseTimeMs: 8, outcome: 'network_error', errorCode: 'timeout' }));
    await expect(service.acceptBaseline('endpoint', endpoint.updatedAt.toISOString())).rejects.toMatchObject({ status: 422 });
    expect(repository.recordCheck).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'network_error', errorCode: 'timeout' }));
    expect(repository.acceptBaseline).not.toHaveBeenCalled();
    expect((await service.check('endpoint')).comparison).toBe('not_compared');
  });

  it('prevents simultaneous checks on one endpoint', async () => {
    const { service } = fixture();
    const pending = service.check('endpoint');
    await expect(service.check('endpoint')).rejects.toMatchObject({ status: 409 });
    await pending;
  });

  it('rejects a fourth active endpoint check before fetching', async () => {
    const { service } = fixture();
    const pending = [service.check('one'), service.check('two'), service.check('three')];
    await expect(service.check('four')).rejects.toMatchObject({ status: 429 });
    await Promise.all(pending);
  });

  it('never returns response bodies or primitive values', async () => {
    const { service } = fixture();
    const result = await service.check('endpoint');
    expect(result).not.toHaveProperty('value');
    expect(result).not.toHaveProperty('body');
  });
});

describe('persistable schema adapter preserves Phase 2 policy', () => {
  it.each([
    [{ id: 1, email: 'a' }, { id: '1', extra: true }],
    [[{ a: 1 }, { b: true }, null], [null, { b: false, a: 2 }]],
    [[], [{ id: 1 }]], [[[]], [[1]]],
    [{ nested: [[{ price: 1 }]] }, { nested: [[{ price: null }]] }],
    [null, { x: [] }],
  ])('matches direct JSON comparison for %j versus %j', (before, after) => {
    expect(compareInferredSchemas(inferJsonSchema(before as JsonValue), inferJsonSchema(after as JsonValue)))
      .toEqual(compareJsonSchema(before as JsonValue, after as JsonValue));
  });
});
