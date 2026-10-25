import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type https from 'node:https';
import type tls from 'node:tls';
import { describe, expect, it, vi } from 'vitest';
import { createPinnedHttpsAgent } from '../src/monitoring/pinned-https-agent.js';

const ip = '104.18.42.17';
const hostname = 'jsonplaceholder.typicode.com';

function socket(peerAddress = ip, peerPort = 443) {
  const result = new PassThrough() as PassThrough & { remoteAddress: string; remotePort: number };
  result.remoteAddress = peerAddress;
  result.remotePort = peerPort;
  return result;
}

function tlsSocket(authorized = true) {
  const result = new PassThrough() as PassThrough & { authorized: boolean };
  result.authorized = authorized;
  return result;
}

describe('pinned HTTPS transport', () => {
  it('dials only the selected literal IPv4 and releases the HTTP socket after verified TLS', async () => {
    const tcp = socket();
    const secure = tlsSocket();
    const connect = vi.fn(() => tcp);
    let tlsOptions: tls.ConnectionOptions | undefined;
    const secureConnect = vi.fn((options: tls.ConnectionOptions) => {
      tlsOptions = options;
      return secure;
    });
    const agent = createPinnedHttpsAgent(ip, hostname, new AbortController().signal, {
      connect: connect as unknown as typeof import('node:net').connect,
      secureConnect: secureConnect as unknown as typeof import('node:tls').connect,
    });

    const connected = new Promise<unknown>((resolve, reject) => {
      const result = agent.createConnection({ host: ip, hostname: ip, port: 443, family: 4 } as https.RequestOptions,
        (error, stream) => error ? reject(error) : resolve(stream));
      expect(result).toBeUndefined();
    });

    expect(connect).toHaveBeenCalledWith({ host: ip, port: 443, family: 4 });
    expect(secureConnect).not.toHaveBeenCalled();
    tcp.emit('connect');
    expect(tlsOptions).toMatchObject({
      socket: tcp, servername: hostname, rejectUnauthorized: true,
      checkServerIdentity: expect.any(Function),
    });
    expect(tlsOptions!.checkServerIdentity!(hostname, {
      subjectaltname: 'DNS:other.example',
    } as tls.DetailedPeerCertificate)).toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    secure.emit('secureConnect');
    await expect(connected).resolves.toBe(secure);
    agent.destroy();
  });

  it.each([["127.0.0.1", 443], [ip, 8443]])('rejects a connected peer that differs from the pinned IP/port (%s:%i)', async (peer, port) => {
    const tcp = socket(peer, port);
    const secureConnect = vi.fn();
    const agent = createPinnedHttpsAgent(ip, hostname, new AbortController().signal, {
      connect: vi.fn(() => tcp) as unknown as typeof import('node:net').connect,
      secureConnect: secureConnect as unknown as typeof import('node:tls').connect,
    });
    const result = new Promise<Error | null>(resolve => {
      agent.createConnection({ host: ip, hostname: ip, port: 443, family: 4 } as https.RequestOptions,
        error => resolve(error));
    });
    tcp.emit('connect');
    await expect(result).resolves.toMatchObject({ message: 'Connected peer did not match the validated destination.' });
    expect(secureConnect).not.toHaveBeenCalled();
    expect(tcp.destroyed).toBe(true);
    agent.destroy();
  });

  it('rejects TLS that is not authorized and destroys its socket', async () => {
    const tcp = socket();
    const secure = tlsSocket(false);
    const agent = createPinnedHttpsAgent(ip, hostname, new AbortController().signal, {
      connect: vi.fn(() => tcp) as unknown as typeof import('node:net').connect,
      secureConnect: vi.fn(() => secure) as unknown as typeof import('node:tls').connect,
    });
    const result = new Promise<Error | null>(resolve => {
      agent.createConnection({ host: ip, hostname: ip, port: 443, family: 4 } as https.RequestOptions,
        error => resolve(error));
    });
    tcp.emit('connect');
    secure.emit('secureConnect');
    await expect(result).resolves.toMatchObject({ message: 'TLS peer authorization failed.' });
    expect(secure.destroyed).toBe(true);
    agent.destroy();
  });

  it('passes certificate-chain failures to the HTTPS request and destroys the failed TLS socket', async () => {
    const tcp = socket();
    const secure = tlsSocket();
    const agent = createPinnedHttpsAgent(ip, hostname, new AbortController().signal, {
      connect: vi.fn(() => tcp) as unknown as typeof import('node:net').connect,
      secureConnect: vi.fn(() => secure) as unknown as typeof import('node:tls').connect,
    });
    const result = new Promise<Error | null>(resolve => {
      agent.createConnection({ host: ip, hostname: ip, port: 443, family: 4 } as https.RequestOptions,
        error => resolve(error));
    });
    tcp.emit('connect');
    secure.emit('error', Object.assign(new Error('certificate is not trusted'), { code: 'CERT_UNTRUSTED' }));
    await expect(result).resolves.toMatchObject({ code: 'CERT_UNTRUSTED' });
    expect(secure.destroyed).toBe(true);
    agent.destroy();
  });

  it('rejects altered agent destination options before opening a socket', async () => {
    const connect = vi.fn();
    const agent = createPinnedHttpsAgent(ip, hostname, new AbortController().signal, {
      connect: connect as unknown as typeof import('node:net').connect,
    });
    const result = new Promise<Error | null>(resolve => {
      agent.createConnection({ host: '127.0.0.1', hostname: '127.0.0.1', port: 443, family: 4 } as https.RequestOptions,
        error => resolve(error));
    });
    await expect(result).resolves.toMatchObject({ message: 'Pinned connection options did not match the validated destination.' });
    expect(connect).not.toHaveBeenCalled();
    agent.destroy();
  });

  it('aborts a pending pinned connection and reports a closed connection', async () => {
    const tcp = socket();
    const controller = new AbortController();
    const agent = createPinnedHttpsAgent(ip, hostname, controller.signal, {
      connect: vi.fn(() => tcp) as unknown as typeof import('node:net').connect,
    });
    const result = new Promise<Error | null>(resolve => {
      agent.createConnection({ host: ip, hostname: ip, port: 443, family: 4 } as https.RequestOptions,
        error => resolve(error));
    });
    controller.abort();
    await expect(result).resolves.toMatchObject({ message: 'Pinned connection was aborted.' });
    expect(tcp.destroyed).toBe(true);
    agent.destroy();
  });
});
