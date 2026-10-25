import https from 'node:https';
import net from 'node:net';
import tls, { checkServerIdentity } from 'node:tls';
import type { Duplex } from 'node:stream';
import { isPublicIpv4 } from './url-policy.js';

type ConnectorDependencies = {
  connect?: typeof net.connect;
  secureConnect?: typeof tls.connect;
};

/**
 * Makes one direct connection to the already validated literal IPv4 address.
 * The HTTP request is not released to Node until the TCP peer and TLS identity
 * have both been checked. This agent never pools or reuses sockets.
 */
export function createPinnedHttpsAgent(
  address: string,
  hostname: string,
  signal: AbortSignal,
  dependencies: ConnectorDependencies = {},
): https.Agent {
  if (!isPublicIpv4(address)) throw new Error('Pinned destination is not permitted.');

  const agent = new https.Agent({
    keepAlive: false,
    maxSockets: 1,
    maxCachedSessions: 0,
    // This agent also uses net.connect directly; no environment proxy is consulted.
    proxyEnv: {},
  });

  agent.createConnection = (options, callback): Duplex | null | undefined => {
    if (!callback) throw new Error('Pinned HTTPS connections require the asynchronous socket callback.');
    const failAsync = (error: Error) => queueMicrotask(() => callback(error, undefined as never));
    if (options.host !== address || options.port !== 443 || options.family !== 4) {
      failAsync(new Error('Pinned connection options did not match the validated destination.'));
      return undefined;
    }
    if (signal.aborted) {
      failAsync(new Error('Pinned connection was aborted.'));
      return undefined;
    }

    const connect = dependencies.connect ?? net.connect;
    const openTls = dependencies.secureConnect ?? tls.connect;
    const tcp = connect({ host: address, port: 443, family: 4 });
    let secureSocket: tls.TLSSocket | undefined;
    let settled = false;

    const finish = (error?: Error, socket?: tls.TLSSocket) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (error) {
        secureSocket?.destroy();
        tcp.destroy();
        callback(error, undefined as never);
      } else if (socket) {
        callback(null, socket);
      } else {
        callback(new Error('Pinned TLS connection failed.'), undefined as never);
      }
    };
    const abort = () => finish(new Error('Pinned connection was aborted.'));
    signal.addEventListener('abort', abort, { once: true });

    tcp.once('error', error => finish(error));
    tcp.once('connect', () => {
      // A peer mismatch is rejected before TLS or any HTTP bytes can be sent.
      if (tcp.remotePort !== 443 || tcp.remoteAddress !== address) {
        return finish(new Error('Connected peer did not match the validated destination.'));
      }

      secureSocket = openTls({
        socket: tcp,
        servername: hostname,
        rejectUnauthorized: true,
        checkServerIdentity: (_serverName, certificate) => checkServerIdentity(hostname, certificate),
      });
      secureSocket.once('error', error => finish(error));
      secureSocket.once('secureConnect', () => {
        if (!secureSocket?.authorized) return finish(new Error('TLS peer authorization failed.'));
        finish(undefined, secureSocket);
      });
    });

    return undefined;
  };
  return agent;
}
