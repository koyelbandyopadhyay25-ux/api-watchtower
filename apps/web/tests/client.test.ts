import { describe, expect, it, vi } from 'vitest';
import { api, loadEndpointRows, supportedUrl } from '../src/api/client';
import { endpoint, endpointId, json } from './fixtures';

describe('local API client', () => {
  it('uses only the relative Vite proxy, required header, and no credentials', async () => {
    const fetch = vi.fn(async () => json(endpoint()));
    vi.stubGlobal('fetch', fetch);
    await api.register('Todo', 'https://jsonplaceholder.typicode.com/todos/1');
    expect(fetch).toHaveBeenCalledWith('/api/endpoints', expect.objectContaining({ method: 'POST', mode: 'same-origin', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { 'X-Watchtower-Local': '1', 'Content-Type': 'application/json' } }));
  });

  it.each(['https://127.0.0.1/', 'https://jsonplaceholder.typicode.com/todos/2',
    'https://user:secret@jsonplaceholder.typicode.com/todos/1', 'https://jsonplaceholder.typicode.com/todos/1?token=x',
    'https://jsonplaceholder.typicode.com:444/todos/1', 'http://jsonplaceholder.typicode.com/todos/1'])('rejects unsupported client input (%s)', url => {
    expect(supportedUrl(url)).toBeNull();
  });

  it('accepts only canonical supported URLs and standard port 443', () => {
    expect(supportedUrl('https://jsonplaceholder.typicode.com:443/todos/1')).toBe('https://jsonplaceholder.typicode.com/todos/1');
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
