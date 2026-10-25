import type { CheckResponse, CheckResult, Endpoint, EndpointRow } from './types';

export const SUPPORTED_URLS = [
  'https://jsonplaceholder.typicode.com/todos/1',
  'https://jsonplaceholder.typicode.com/posts/1',
] as const;

export function supportedUrl(value: string): string | null {
  const input = value.trim();
  try {
    const url = new URL(input);
    if (/[\\@?#\s]/.test(input)) return null;
    return SUPPORTED_URLS.some(allowed => allowed === url.href) ? url.href : null;
  } catch { return null; }
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'The request could not be completed. Try refreshing the page.';
  const messages: Record<string, string> = {
    url_not_allowed: 'This URL is not supported. Choose one of the two public test URLs.',
    endpoint_not_found: 'This endpoint no longer exists. Return to the endpoint list.',
    stale_baseline_acceptance: 'The endpoint changed since this page loaded. Review the refreshed baseline and confirm again.',
    database_conflict: 'The endpoint changed during acceptance. Review the refreshed baseline and confirm again.',
    check_already_running: 'A check is already running for this endpoint. Wait, then refresh its history.',
    check_capacity_reached: 'The API is running three checks. Wait a moment before trying again.',
    baseline_capture_failed_check_saved: 'The baseline was not changed. The fresh check failed and was saved in history.',
    network_error: 'Cannot reach the local API. Check that the backend is running and the Vite proxy is available.',
    request_timeout: 'The request timed out. It may still finish on the server; refresh history before trying again.',
    invalid_response: 'The local API returned an unexpected response. Refresh before trying again.',
  };
  if (messages[error.code]) return messages[error.code]!;
  if (error.status === 404) return 'Local management is unavailable. Enable NODE_ENV=development and ENABLE_LOCAL_MANAGEMENT=true in the backend terminal.';
  if (error.status === 403) return 'The local API rejected the request. Open this dashboard through the local Vite server on port 5173; keep the existing API guards enabled.';
  if (error.status === 503) return 'The database operation could not be confirmed. Check local PostgreSQL, then refresh the endpoint and history.';
  if (error.status === 400) return 'The request was not accepted. Check the endpoint name and supported URL.';
  return 'The operation could not be confirmed. Refresh the endpoint and history before retrying.';
}

async function request<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
  try {
    if (options.signal?.aborted) controller.abort();
    const response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: { 'X-Watchtower-Local': '1', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      mode: 'same-origin', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'request_failed';
      throw new ApiError(response.status, code);
    }
    if (data === null) throw new ApiError(response.status, 'invalid_response');
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, timedOut ? 'request_timeout' : 'network_error');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export const api = {
  list: (signal?: AbortSignal) => request<{ endpoints: Endpoint[] }>('/endpoints?limit=100', { signal }),
  get: (id: string, signal?: AbortSignal) => request<Endpoint>(`/endpoints/${encodeURIComponent(id)}`, { signal }),
  register: (name: string, url: string) => request<Endpoint>('/endpoints', { method: 'POST', body: { name, url } }),
  history: (id: string, limit = 100, signal?: AbortSignal) => request<{ checks: CheckResult[] }>(`/endpoints/${encodeURIComponent(id)}/checks?limit=${limit}`, { signal }),
  check: (id: string) => request<CheckResponse>(`/endpoints/${encodeURIComponent(id)}/checks`, { method: 'POST', body: {} }),
  acceptBaseline: (id: string, expectedUpdatedAt: string) => request<CheckResponse>(`/endpoints/${encodeURIComponent(id)}/baseline`, {
    method: 'PUT', body: { accept: true, expectedUpdatedAt },
  }),
};

/** The existing list route omits check data. Bound read fan-out, without backend changes. */
export async function loadEndpointRows(signal: AbortSignal): Promise<EndpointRow[]> {
  const { endpoints } = await api.list(signal);
  const rows: EndpointRow[] = endpoints.map(endpoint => ({ endpoint, latest: null, historyError: null }));
  let next = 0;
  async function worker() {
    while (next < rows.length && !signal.aborted) {
      const index = next++;
      const row = rows[index]!;
      try {
        const { checks } = await api.history(row.endpoint.id, 1, signal);
        row.latest = checks[0] ?? null;
      } catch (error) {
        if (signal.aborted) throw error;
        row.historyError = errorMessage(error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, worker));
  return rows;
}
