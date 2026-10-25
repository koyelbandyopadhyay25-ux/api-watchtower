import { Resolver } from 'node:dns/promises';
import https from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { performance } from 'node:perf_hooks';
import type { JsonValue } from '../schema-comparison/schema-types.js';
import { isPublicIpv4, validateTarget } from './url-policy.js';

export const FETCH_LIMITS = { timeoutMs: 8_000, maxBytes: 128 * 1024, maxDepth: 50, maxNodes: 5_000, concurrency: 3 };

type FetchErrorCode = 'timeout' | 'dns_failure' | 'connection_failure' | 'tls_failure'
  | 'http_status' | 'invalid_json' | 'unknown';

export type FetchResult = {
  httpStatus: number | null;
  responseTimeMs: number;
} & (
  | { ok: true; value: JsonValue }
  | { ok: false; outcome: 'http_error' | 'network_error' | 'invalid_json';
      errorCode: FetchErrorCode }
);

export class FetchBusyError extends Error {}
class FetchFailure extends Error {
  constructor(readonly outcome: 'http_error' | 'network_error' | 'invalid_json',
    readonly errorCode: FetchErrorCode) { super(errorCode); }
}

async function resolveIpv4(hostname: string, signal: AbortSignal): Promise<string[]> {
  const resolver = new Resolver({ timeout: 3_000, tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    return await resolver.resolve4(hostname);
  } catch {
    throw new FetchFailure('network_error', signal.aborted ? 'timeout' : 'dns_failure');
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

function assertJsonComplexity(value: JsonValue): void {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++nodes > FETCH_LIMITS.maxNodes || current.depth > FETCH_LIMITS.maxDepth) {
      throw new FetchFailure('invalid_json', 'invalid_json');
    }
    if (typeof current.value === 'number' && !Number.isFinite(current.value)) {
      throw new FetchFailure('invalid_json', 'invalid_json');
    }
    if (current.value !== null && typeof current.value === 'object') {
      for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function readJson(url: URL, address: string, signal: AbortSignal, request: typeof https.request,
  onStatus: (status: number) => void): Promise<JsonValue> {
  return new Promise((resolve, reject) => {
    const req = request({
      // Dial a validated literal IP: there is no second hostname resolution.
      hostname: address, family: 4, port: 443, method: 'GET', path: url.pathname,
      servername: url.hostname, rejectUnauthorized: true,
      checkServerIdentity: (_name, certificate) => checkServerIdentity(url.hostname, certificate),
      headers: { Host: url.hostname, Accept: 'application/json', 'Accept-Encoding': 'identity' },
      agent: false, signal, maxHeaderSize: 16 * 1024,
    }, response => {
      const status = response.statusCode ?? 0;
      onStatus(status);
      const fail = (error: FetchFailure) => { reject(error); response.destroy(); req.destroy(); };
      response.on('error', reject);
      response.on('aborted', () => reject(new FetchFailure('network_error', 'connection_failure')));
      // Node's request does not follow redirects. Never inspect or fetch Location.
      if (status < 200 || status >= 300) return fail(new FetchFailure('http_error', 'http_status'));
      const contentType = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? '';
      if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(contentType) ||
          (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
        return fail(new FetchFailure('invalid_json', 'invalid_json'));
      }
      const declaredLength = Number(response.headers['content-length']);
      if (declaredLength > FETCH_LIMITS.maxBytes) return fail(new FetchFailure('invalid_json', 'invalid_json'));
      let size = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > FETCH_LIMITS.maxBytes) return fail(new FetchFailure('invalid_json', 'invalid_json'));
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
          const value: JsonValue = JSON.parse(text);
          assertJsonComplexity(value);
          resolve(value);
        } catch { reject(new FetchFailure('invalid_json', 'invalid_json')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export function createSafeJsonFetcher(dependencies: {
  resolve?: typeof resolveIpv4;
  request?: typeof https.request;
  timeoutMs?: number;
} = {}) {
  let active = 0;
  return async (target: string, externalSignal?: AbortSignal): Promise<FetchResult> => {
    if (active >= FETCH_LIMITS.concurrency) throw new FetchBusyError('Check capacity reached.');
    active++;
    const start = performance.now();
    let httpStatus: number | null = null;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    externalSignal?.addEventListener('abort', cancel, { once: true });
    if (externalSignal?.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? FETCH_LIMITS.timeoutMs);
    try {
      const url = validateTarget(target);
      controller.signal.throwIfAborted();
      const addresses = await (dependencies.resolve ?? resolveIpv4)(url.hostname, controller.signal);
      controller.signal.throwIfAborted();
      if (!addresses.length || !addresses.every(isPublicIpv4)) throw new FetchFailure('network_error', 'unknown');
      const address = [...addresses].sort()[0]!;
      const value = await readJson(url, address, controller.signal, dependencies.request ?? https.request,
        status => { httpStatus = status >= 100 && status <= 599 ? status : null; });
      return { ok: true, value, httpStatus, responseTimeMs: Math.round(performance.now() - start) };
    } catch (error) {
      let failure = error instanceof FetchFailure ? error : new FetchFailure('network_error', 'unknown');
      const code = (error as NodeJS.ErrnoException)?.code ?? '';
      if (controller.signal.aborted) failure = new FetchFailure('network_error', 'timeout');
      else if (['ENOTFOUND', 'ENODATA', 'EAI_AGAIN', 'ESERVFAIL'].includes(code)) failure = new FetchFailure('network_error', 'dns_failure');
      else if (code.includes('CERT') || code.includes('TLS') || code.includes('SSL')) failure = new FetchFailure('network_error', 'tls_failure');
      else if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
        failure = new FetchFailure('network_error', 'connection_failure');
      }
      return { ok: false, httpStatus, responseTimeMs: Math.round(performance.now() - start),
        outcome: failure.outcome, errorCode: failure.errorCode };
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', cancel);
      active--;
    }
  };
}
