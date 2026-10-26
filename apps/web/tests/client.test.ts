import { describe, expect, it, vi } from 'vitest';
import { api, loadEndpointRows, supportedUrl, SUPPORTED_ENDPOINTS } from '../src/api/client';
import { endpoint, endpointId, json } from './fixtures';

describe('local API client', () => {
  it('rejects incomplete scheduling information instead of inventing disabled defaults', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ endpointId, enabled: false, intervalMinutes: 15 })));
    await expect(api.schedule(endpointId)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('uses only the relative Vite proxy, required header, and same-origin cookies', async () => {
    const fetch = vi.fn(async () => json(endpoint()));
    vi.stubGlobal('fetch', fetch);
    await api.register('Todo', 'https://jsonplaceholder.typicode.com/todos/1');
    expect(fetch).toHaveBeenCalledWith('/api/endpoints', expect.objectContaining({ method: 'POST', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: { 'X-Watchtower-Local': '1', 'Content-Type': 'application/json' } }));
  });

  it.each(['https://127.0.0.1/', 'https://jsonplaceholder.typicode.com/todos/2',
    'https://user:secret@jsonplaceholder.typicode.com/todos/1', 'https://jsonplaceholder.typicode.com/todos/1?token=x',
    'https://jsonplaceholder.typicode.com:444/todos/1', 'http://jsonplaceholder.typicode.com/todos/1',
    'https://jsonplaceholder.typicode.com/users/1/extra', 'https://jsonplaceholder.typicode.com/posts/1/comments?x=1',
    'https://jsonplaceholder.typicode.com/posts%2f1/comments', 'https://jsonplaceholder.typicode.com/%75sers/1',
    'https://jsonplaceholder.typicode.com/users/2/../1', 'https://JSONPLACEHOLDER.typicode.com/users/1',
    ' https://jsonplaceholder.typicode.com/users/1', 'https://jsonplaceholder.typicode.com/users/1#frag',
    'https://www.gov.uk/api/bank-holidays.json', 'https://www.gov.uk/bank-holidays.json?x=1',
    'https://nagerholidays.com/api/v4/Holidays/AT/2026', 'https://dummyjson.com/products/categories/extra'])('rejects unsupported client input (%s)', url => {
    expect(supportedUrl(url)).toBeNull();
  });

  it.each(SUPPORTED_ENDPOINTS)('uses the shared frontend/backend catalog for $label', endpoint => {
    expect(supportedUrl(endpoint.url)).toBe(endpoint.url);
    const parsed = new URL(endpoint.url);
    expect(supportedUrl(`${parsed.protocol}//${parsed.hostname}:443${parsed.pathname}`)).toBe(endpoint.url);
  });

  it('limits latest-history reads to four in flight', async () => {
    let active = 0;
    let maximum = 0;
    const endpoints = Array.from({ length: 12 }, (_, index) => endpoint({ id: `${endpointId}-${index}` }));
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path.startsWith('/api/endpoints?')) return json({ endpoints });
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      return json({ checks: [] });
    }));
    const rows = await loadEndpointRows(new AbortController().signal);
    expect(rows).toHaveLength(12);
    expect(maximum).toBe(4);
    expect(rows.every(row => row.latest === null && row.historyError === null)).toBe(true);
  });
});
