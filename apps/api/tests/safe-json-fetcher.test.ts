import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type https from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { DetailedPeerCertificate } from 'node:tls';
import { describe, expect, it, vi } from 'vitest';
import { createSafeJsonFetcher, FETCH_LIMITS, FetchBusyError } from '../src/monitoring/safe-json-fetcher.js';
import { isPublicIpv4, validateTarget } from '../src/monitoring/url-policy.js';

const target = 'https://jsonplaceholder.typicode.com/todos/1';
const publicIp = '104.18.42.17';

function transport(options: {
  status?: number; contentType?: string; body?: string; chunks?: Buffer[];
  headers?: Record<string, string>; hang?: boolean; stallBody?: boolean; errorCode?: string;
} = {}) {
  const request = vi.fn((settings: https.RequestOptions, callback: (response: IncomingMessage) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    let destroyed = false;
    req.destroy = () => { destroyed = true; };
    settings.signal?.addEventListener('abort', () => req.emit('error', Object.assign(new Error('aborted'), { code: 'ABORT_ERR' })), { once: true });
    req.end = () => queueMicrotask(() => {
      if (options.errorCode) return void req.emit('error', Object.assign(new Error('private driver details'), { code: options.errorCode }));
      if (options.hang) return;
      const response = Object.assign(new PassThrough(), {
        statusCode: options.status ?? 200,
        headers: { 'content-type': options.contentType ?? 'application/json', ...options.headers },
      });
      callback(response as unknown as IncomingMessage);
      if (!destroyed) {
        for (const chunk of options.chunks ?? [Buffer.from(options.body ?? '{"id":1}')]) {
          if (!destroyed) response.write(chunk);
        }
        if (!destroyed && !options.stallBody) response.end();
      }
    });
    return req;
  });
  return request;
}

function fetcher(options: Parameters<typeof transport>[0] = {}) {
  const request = transport(options);
  const resolve = vi.fn(async () => [publicIp]);
  return { request, resolve, check: createSafeJsonFetcher({ request: request as unknown as typeof https.request, resolve, timeoutMs: 30 }) };
}

describe('URL policy and SSRF restrictions', () => {
  it('accepts only the exact allowed destinations, including explicit standard port', () => {
    expect(validateTarget(target).href).toBe(target);
    expect(validateTarget(target.replace('.com/', '.com:443/')).href).toBe(target);
  });

  it.each([
    'not a URL', 'http://jsonplaceholder.typicode.com/todos/1',
    'https://jsonplaceholder.typicode.com:444/todos/1',
    'https://user:secret@jsonplaceholder.typicode.com/todos/1',
    'https://jsonplaceholder.typicode.com/todos/1?token=secret',
    'https://jsonplaceholder.typicode.com/todos/1#fragment',
    'https://jsonplaceholder.typicode.com.evil.test/todos/1',
    'https://jsonplaceholder.typicode.com/other', 'https://example.com/',
    'https://localhost/', 'https://127.0.0.1/', 'https://2130706433/',
    'https://10.0.0.1/', 'https://169.254.169.254/',
    'https://[::1]/', 'https://[fd00::1]/', 'https://[fe80::1]/', 'https://[::ffff:127.0.0.1]/',
  ])('rejects an untrusted target before DNS or HTTP (%s)', async url => {
    const { check, request, resolve } = fetcher();
    expect(validateTarget.bind(null, url)).toThrow();
    expect(await check(url)).toMatchObject({ ok: false, httpStatus: null });
    expect(resolve).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['0.1.2.3', '10.0.0.1', '127.0.0.1', '100.100.100.200', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.0.0.9', '192.168.0.1', '192.88.99.1',
    '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1', '224.0.0.1',
    '255.255.255.255', '168.63.129.16', '::1', '::ffff:8.8.8.8', 'fd00::1', 'fe80::1'])('rejects non-public or IPv6 DNS addresses (%s)', async address => {
    const request = transport();
    expect(isPublicIpv4(address)).toBe(false);
    const check = createSafeJsonFetcher({ resolve: async () => [publicIp, address], request: request as unknown as typeof https.request });
    expect(await check(target)).toMatchObject({ ok: false, httpStatus: null });
    expect(request).not.toHaveBeenCalled();
  });

  it('pins one validated address without a second DNS resolution and retains TLS verification', async () => {
    const { check, resolve, request } = fetcher();
    resolve.mockResolvedValueOnce([publicIp]).mockResolvedValueOnce(['127.0.0.1']);
    expect(await check(target)).toMatchObject({ ok: true, value: { id: 1 } });
    expect(resolve).toHaveBeenCalledTimes(1);
    const options = request.mock.calls[0]![0];
    expect(options).toMatchObject({ hostname: publicIp, port: 443, family: 4,
      servername: 'jsonplaceholder.typicode.com', rejectUnauthorized: true, agent: false,
      headers: { Host: 'jsonplaceholder.typicode.com', 'Accept-Encoding': 'identity' } });
    expect(options.checkServerIdentity).toBeTypeOf('function');
    const mismatchedCertificate = { subjectaltname: 'DNS:attacker.example' } as DetailedPeerCertificate;
    expect(options.checkServerIdentity!('ignored', mismatchedCertificate)).toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    expect(options.lookup).toBeUndefined(); // Hostname is already a literal IPv4 address.
    expect(await check(target)).toMatchObject({ ok: false });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('bounded JSON HTTPS checking', () => {
  it('reports actual metadata and valid JSON, without caller-supplied headers', async () => {
    const { check, request } = fetcher({ contentType: 'application/problem+json; charset=utf-8', body: 'null' });
    expect(await check(target)).toMatchObject({ ok: true, httpStatus: 200, value: null, responseTimeMs: expect.any(Number) });
    expect(Object.keys(request.mock.calls[0]![0].headers!)).toEqual(['Host', 'Accept', 'Accept-Encoding']);
  });

  it.each([301, 302, 307, 308, 404, 500])('records HTTP %i without following redirects or reading a body', async status => {
    const { check, request } = fetcher({ status, headers: { location: 'https://127.0.0.1/private' }, body: 'not json' });
    expect(await check(target)).toMatchObject({ ok: false, httpStatus: status, outcome: 'http_error', errorCode: 'http_status' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each<NonNullable<Parameters<typeof transport>[0]>>([
    { contentType: 'text/html', body: '<html>private</html>' },
    { body: 'not JSON' }, { body: '' }, { body: '1e400' },
    { headers: { 'content-encoding': 'gzip' } },
    { chunks: [Buffer.from([0xff, 0xfe])] },
    { headers: { 'content-length': String(FETCH_LIMITS.maxBytes + 1) } },
    { chunks: [Buffer.alloc(FETCH_LIMITS.maxBytes), Buffer.from('x')] },
    { body: '['.repeat(60) + '1' + ']'.repeat(60) },
    { body: JSON.stringify(Array.from({ length: 5_001 }, () => 1)) },
  ])('rejects invalid, compressed, oversized, or excessive JSON (%j)', async input => {
    expect(await fetcher(input).check(target)).toMatchObject({ ok: false, httpStatus: 200, outcome: 'invalid_json' });
  });

  it('enforces an absolute timeout while waiting for HTTP', async () => {
    expect(await fetcher({ hang: true }).check(target)).toMatchObject({ ok: false, outcome: 'network_error', errorCode: 'timeout' });
  });

  it('keeps the deadline active while the body is stalled, retaining the received status', async () => {
    expect(await fetcher({ stallBody: true }).check(target)).toMatchObject({ ok: false, httpStatus: 200, errorCode: 'timeout' });
  });

  it('reports a DNS failure before making an HTTP request', async () => {
    const request = transport();
    const check = createSafeJsonFetcher({ request: request as unknown as typeof https.request,
      resolve: async () => { throw Object.assign(new Error('private resolver details'), { code: 'ENOTFOUND' }); } });
    expect(await check(target)).toMatchObject({ ok: false, httpStatus: null, errorCode: 'dns_failure' });
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses empty DNS answers without making a request', async () => {
    const request = transport();
    const check = createSafeJsonFetcher({ request: request as unknown as typeof https.request, resolve: async () => [] });
    expect(await check(target)).toMatchObject({ ok: false, httpStatus: null });
    expect(request).not.toHaveBeenCalled();
  });

  it('cancels a stalled DNS resolution on the same deadline', async () => {
    const request = transport();
    const check = createSafeJsonFetcher({ timeoutMs: 10, request: request as unknown as typeof https.request,
      resolve: (_host, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      }) });
    expect(await check(target)).toMatchObject({ ok: false, errorCode: 'timeout' });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([['ECONNRESET', 'connection_failure'], ['CERT_HAS_EXPIRED', 'tls_failure']])('categorizes %s without raw errors', async (code, category) => {
    const result = await fetcher({ errorCode: code }).check(target);
    expect(result).toMatchObject({ ok: false, errorCode: category });
    expect(JSON.stringify(result)).not.toContain('private driver details');
  });

  it('rejects a fourth concurrent request without queuing and releases slots after timeouts', async () => {
    const { check } = fetcher({ hang: true });
    const pending = [check(target), check(target), check(target)];
    await expect(check(target)).rejects.toBeInstanceOf(FetchBusyError);
    await Promise.all(pending);
    expect(await check(target)).toMatchObject({ ok: false, errorCode: 'timeout' });
  });
});
