import { describe, expect, it } from 'vitest';
import { serializeBaseline, type BaselineSchema } from '../src/database/baseline-schema.js';
import { assertDisposableDatabase } from '../src/database/disposable-database.js';
import { databaseOperation, DatabaseError } from '../src/database/database-errors.js';
import { createMonitoringRepository } from '../src/database/monitoring-repository.js';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';

describe('disposable database guards', () => {
  const dev = 'postgresql://user:password@localhost:5432/watchtower_dev?schema=public';
  const test = 'postgresql://user:password@127.0.0.1:5433/watchtower_test';

  it('accepts only explicitly confirmed, correctly named local databases', () => {
    expect(assertDisposableDatabase(dev, 'development', 'true')).toBe(dev);
    expect(assertDisposableDatabase(test, 'test', 'true')).toBe(test);
  });

  it.each([
    [undefined, 'true'], [test, undefined], [test, 'false'],
    [dev, 'true'], ['postgresql://user:pass@example.com/watchtower_test', 'true'],
    ['postgresql://user:pass@localhost/production', 'true'],
    [`${test}?schema=private`, 'true'], [`${test}?options=unsafe`, 'true'],
    ['not a URL', 'true'],
  ])('rejects an unsafe test configuration without connecting (%s)', (url, confirmation) => {
    expect(() => assertDisposableDatabase(url, 'test', confirmation)).toThrow();
  });
});

describe('baseline storage validation', () => {
  it('serializes nested structural metadata deterministically', () => {
    expect(serializeBaseline({ types: ['object'], properties: {
      items: { types: ['array'], items: { types: ['string', 'null', 'string'] } },
    } })).toEqual({ types: ['object'], properties: {
      items: { types: ['array'], items: { types: ['null', 'string'] } },
    } });
  });

  it.each([
    { id: 101, email: 'private@example.com' },
    { types: ['string'], value: 'secret' },
    { types: [] }, { types: ['date'] },
    { types: ['string'], properties: {} },
    { types: ['object'], items: { types: ['number'] } },
  ])('rejects response values or invalid structure (%j)', value => {
    expect(() => serializeBaseline(value as unknown as BaselineSchema)).toThrow();
  });
});

describe('safe database errors', () => {
  it('does not return raw driver messages or secrets', async () => {
    await expect(databaseOperation(async () => {
      throw new Error('postgresql://user:secret@host/db private response body');
    })).rejects.toEqual(new DatabaseError('operation_failed'));
  });

  it.each([['P2025', 'not_found'], ['P2003', 'conflict'], ['P2024', 'unavailable']] as const)(
    'maps Prisma %s to %s', async (code, expected) => {
      await expect(databaseOperation(async () => {
        throw new Prisma.PrismaClientKnownRequestError('private details', { code, clientVersion: '7.10.1' });
      })).rejects.toEqual(new DatabaseError(expected));
    },
  );
});

describe('repository input validation before database access', () => {
  // No database methods: any accidental DB access in these cases fails the test.
  const repository = createMonitoringRepository({} as PrismaClient);

  it.each([
    'https://user:secret@example.com/api',
    'https://example.com/api?token=secret',
    'https://example.com/api#secret',
    'file:///etc/passwd',
  ])('rejects URLs that could store credentials or query secrets (%s)', async url => {
    await expect(repository.createEndpoint({ name: 'Test', url })).rejects.toThrow('HTTP(S) URL');
  });

  it('rejects invalid HTTP metadata and history limits', async () => {
    await expect(repository.recordCheck({
      endpointId: 'unused', httpStatus: 999, responseTimeMs: 1, outcome: 'success',
    })).rejects.toThrow('HTTP status');
    await expect(repository.recordCheck({
      endpointId: 'unused', httpStatus: 200, responseTimeMs: -1, outcome: 'success',
    })).rejects.toThrow('Response time');
    await expect(repository.listCheckResults('unused', 0)).rejects.toThrow('History limit');
  });
});
