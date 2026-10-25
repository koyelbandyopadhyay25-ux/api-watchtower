import { isIPv4 } from 'node:net';

// Exact paths, not arbitrary hosts or caller-configurable destinations.
export const ALLOWED_ENDPOINT_URLS = [
  'https://jsonplaceholder.typicode.com/todos/1',
  'https://jsonplaceholder.typicode.com/posts/1',
] as const;

export class UrlPolicyError extends Error {
  constructor() { super('Only the documented public HTTPS test URLs on port 443 are allowed.'); }
}

export function validateTarget(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new UrlPolicyError(); }
  if (value.length > 2048 || value !== value.trim() || /[\\@?#\s]/.test(value) ||
      url.protocol !== 'https:' || (url.port !== '' && url.port !== '443') ||
      url.username || url.password || !ALLOWED_ENDPOINT_URLS.some(allowed => allowed === url.href)) {
    throw new UrlPolicyError();
  }
  return url;
}

/** IPv4-only transport. IPv6/mapped addresses are never eligible for dialing. */
export function isPublicIpv4(address: string): boolean {
  if (!isIPv4(address)) return false;
  const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) || address === '168.63.129.16');
}
