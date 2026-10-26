import { isIPv4 } from 'node:net';
import { canonicalSupportedUrl, SUPPORTED_ENDPOINTS } from './supported-endpoints.js';

// Exact paths, not arbitrary hosts or caller-configurable destinations.
export const ALLOWED_ENDPOINT_URLS = SUPPORTED_ENDPOINTS.map(endpoint => endpoint.url);

export class UrlPolicyError extends Error {
  constructor() { super('Only exact documented public HTTPS destinations on port 443 are allowed.'); }
}

export function validateTarget(value: string): URL {
  const approved = canonicalSupportedUrl(value);
  if (!approved) throw new UrlPolicyError();
  return new URL(approved);
}

function ipv4Number(address: string): number {
  const octets = address.split('.').map(Number);
  return (((octets[0]! * 256 + octets[1]!) * 256 + octets[2]!) * 256 + octets[3]!) >>> 0;
}

const blockedIpv4Ranges: Array<[network: number, prefix: number]> = ([
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4], ['168.63.129.16', 32],
] as const).map(([network, prefix]) => [ipv4Number(network), prefix]);

/** IPv4-only transport. IPv6/mapped addresses are never eligible for dialing. */
export function isPublicIpv4(address: string): boolean {
  if (!isIPv4(address)) return false;
  // These two anycast addresses are globally reachable exceptions within 192.0.0.0/24.
  if (address === '192.0.0.9' || address === '192.0.0.10') return true;
  const value = ipv4Number(address);
  return !blockedIpv4Ranges.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
    return (value & mask) === (network & mask);
  });
}
