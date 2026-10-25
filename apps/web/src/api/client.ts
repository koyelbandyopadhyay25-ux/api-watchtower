import type { CheckResponse, CheckResult, Endpoint, EndpointRow, MonitoringSchedule, ScheduledRun, NotificationSettings, NotificationEvent } from './types';

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
export interface AuthenticatedSession { user: { id: string; email: string }; csrfToken: string; expiresAt: string }
let csrfToken: string | null = null;
export function clearAuthentication() { csrfToken = null; }

export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'The request could not be completed. Try refreshing the page.';
  const messages: Record<string, string> = {
    authentication_required: 'Your session has expired. Sign in again.',
    invalid_credentials: 'Email or password is incorrect.',
    invalid_credentials_format: 'Enter a valid email and a password with 12–128 characters.',
    csrf_invalid: 'The security token is out of date. Reload the page before trying again.',
    authentication_rate_limited: 'Too many authentication attempts. Wait 15 minutes before trying again.',
    authentication_busy: 'Authentication is busy. Try again in a moment.',
    stale_notification_settings: 'Notification settings changed elsewhere. Refresh and review them before saving again.',
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
      headers: { 'X-Watchtower-Local': '1', ...(options.body !== undefined ? { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) } : {}) },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'request_failed';
      if (response.status === 401 && code === 'authentication_required') {
        clearAuthentication(); window.dispatchEvent(new Event('watchtower:session-expired'));
      }
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

async function restoreSession(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}) {
  const session = await request<AuthenticatedSession>(path, options);
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!session.user?.id || !session.user.email || !/^[A-Za-z0-9_-]{43}$/.test(session.csrfToken) || !Number.isFinite(Date.parse(session.expiresAt))) throw new ApiError(200, 'invalid_response');
  csrfToken = session.csrfToken;
  return session;
}
export const authApi = {
  session: (signal?: AbortSignal) => restoreSession('/auth/session', { signal }),
  login: (email: string, password: string) => restoreSession('/auth/login', { method: 'POST', body: { email, password } }),
  register: (email: string, password: string) => request<{ message: string }>('/auth/register', { method: 'POST', body: { email, password } }),
  logout: async () => { await request('/auth/logout', { method: 'POST', body: {} }); clearAuthentication(); },
};

export const api = {
  notificationSettings: async (id: string, signal?: AbortSignal) => {
    const value = await request<NotificationSettings>(`/endpoints/${encodeURIComponent(id)}/notification-settings`, { signal });
    if (value.endpointId !== id || typeof value.enabled !== 'boolean' || !(value.updatedAt === null || (typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))))) throw new ApiError(200, 'invalid_response');
    return value;
  },
  configureNotifications: (id: string, enabled: boolean, expectedUpdatedAt: string | null) => request<NotificationSettings>(`/endpoints/${encodeURIComponent(id)}/notification-settings`, { method: 'PUT', body: { enabled, expectedUpdatedAt } }),
  notifications: (id: string, signal?: AbortSignal) => request<{ events: NotificationEvent[] }>(`/endpoints/${encodeURIComponent(id)}/notifications?limit=50`, { signal }),
  schedule: async (id: string, signal?: AbortSignal) => {
    const value = await request<MonitoringSchedule>(`/endpoints/${encodeURIComponent(id)}/schedule`, { signal });
    const times = [value.nextRunAt, value.lastStartedAt, value.lastFinishedAt, value.updatedAt];
    if (typeof value.enabled !== 'boolean' || ![5, 15, 30, 60].includes(value.intervalMinutes) || value.endpointId !== id ||
      !times.every(time => time === null || (typeof time === 'string' && Number.isFinite(Date.parse(time)))) ||
      !(value.lastErrorCode === null || typeof value.lastErrorCode === 'string')) throw new ApiError(200, 'invalid_response');
    return value;
  },
  configureSchedule: (id: string, settings: Pick<MonitoringSchedule, 'enabled' | 'intervalMinutes'>) => request<MonitoringSchedule>(`/endpoints/${encodeURIComponent(id)}/schedule`, { method: 'PUT', body: settings }),
  scheduledHistory: (id: string, signal?: AbortSignal) => request<{ runs: ScheduledRun[] }>(`/endpoints/${encodeURIComponent(id)}/scheduled-checks?limit=1`, { signal }),
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
