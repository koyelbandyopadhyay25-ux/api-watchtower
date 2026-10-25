import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { check, changes, endpoint, endpointId, initialTimestamp, json, mockApi, nextTimestamp } from './fixtures';

function showDetail() {
  window.history.replaceState(null, '', `/#endpoints/${endpointId}`);
  render(<App />);
}

describe('endpoint list and registration', () => {
  it('loads real API records and distinguishes healthy, failed, changed, and never checked states', async () => {
    const endpoints = [endpoint(), endpoint({ id: '22222222-2222-4222-8222-222222222222', name: 'Failing API' }),
      endpoint({ id: '33333333-3333-4333-8333-333333333333', name: 'Changed API' }), endpoint({ id: '44444444-4444-4444-8444-444444444444', name: 'New API' })];
    mockApi({ endpoints, checks: {
      [endpoints[0]!.id]: [check({ responseTimeMs: 0 })],
      [endpoints[1]!.id]: [check({ outcome: 'http_error', httpStatus: 503 })],
      [endpoints[2]!.id]: [check({ outcome: 'schema_changed', schemaChanges: changes })],
    } });
    render(<App />);
    await screen.findByText('Healthy');
    for (const [name, status] of [['Todo API', 'Healthy'], ['Failing API', 'Failed'], ['Changed API', 'Schema changed'], ['New API', 'Never checked']]) {
      const row = screen.getByRole('link', { name }).closest('tr')!;
      expect(within(row).getByText(status!)).toBeInTheDocument();
    }
    expect(screen.getByText('0 ms')).toBeInTheDocument();
    expect(screen.getAllByText('2026-10-25 11:00:00')).toHaveLength(3);
  });

  it('shows loading without fabricated rows or statistics', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    render(<App />);
    expect(screen.getByText('Loading registered endpoints and latest results…')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    await act(async () => resolve(json({ endpoints: [] })));
    expect(await screen.findByText('No endpoints registered')).toBeInTheDocument();
  });

  it('distinguishes a failed latest-result read from never checked', async () => {
    const { state } = mockApi();
    state.failedHistory.add(endpointId);
    render(<App />);
    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Never checked')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Todo API' })).toBeInTheDocument();
  });

  it('explains disabled local management and can retry a failed list request', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: 'request_failed' }, 404)).mockResolvedValueOnce(json({ endpoints: [] }));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('ENABLE_LOCAL_MANAGEMENT=true');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('No endpoints registered')).toBeInTheDocument();
  });

  it('validates names and unsupported URLs before registering', async () => {
    const { state } = mockApi({ endpoints: [] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }));
    await user.click(screen.getByRole('button', { name: 'Register endpoint' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an endpoint name');
    await user.type(screen.getByLabelText('Endpoint name'), 'My API');
    await user.type(screen.getByLabelText('HTTPS URL'), 'https://127.0.0.1/');
    await user.click(screen.getByRole('button', { name: 'Register endpoint' }));
    expect(screen.getByRole('alert')).toHaveTextContent('This URL is not supported');
    expect(state.calls.filter(call => call.method === 'POST')).toHaveLength(0);
  });

  it('registers a supported preset, closes the dialog, and reloads the endpoint list', async () => {
    const { state } = mockApi({ endpoints: [] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }));
    await user.type(screen.getByLabelText('Endpoint name'), 'Post response');
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(screen.getByLabelText('HTTPS URL')).toHaveValue('https://jsonplaceholder.typicode.com/posts/1');
    await user.click(screen.getByRole('button', { name: 'Register endpoint' }));
    expect(await screen.findByRole('link', { name: 'Post response' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Never checked')).toBeInTheDocument();
    expect(state.calls.filter(call => call.method === 'POST')).toEqual([{ path: '/api/endpoints', method: 'POST', body: { name: 'Post response', url: 'https://jsonplaceholder.typicode.com/posts/1' } }]);
  });

  it('supports cancellation and restores keyboard focus to the opener', async () => {
    mockApi({ endpoints: [] });
    const user = userEvent.setup();
    render(<App />);
    const opener = screen.getByRole('button', { name: 'Add endpoint' });
    await user.click(opener);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('refreshes persisted state instead of manufacturing updates', async () => {
    const { state } = mockApi({ endpoints: [] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('No endpoints registered');
    state.endpoints.push(endpoint());
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('link', { name: 'Todo API' })).toBeInTheDocument();
  });
});

describe('endpoint detail, checking, and history', () => {
  it('handles empty history and missing baselines without implied compatibility', async () => {
    mockApi();
    showDetail();
    expect(await screen.findByText('No checks recorded')).toBeInTheDocument();
    expect(screen.getByText('Never checked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Capture baseline' })).toBeEnabled();
    expect(screen.getByText(/No detected changes does not prove complete compatibility/)).toBeInTheDocument();
  });

  it('runs a check and reloads its actual status, latency, and history', async () => {
    const { state } = mockApi();
    const user = userEvent.setup();
    showDetail();
    await screen.findByText('No checks recorded');
    await user.click(screen.getByRole('button', { name: 'Run check' }));
    expect(await screen.findByText(/Check saved. No baseline has been accepted/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('table', { name: 'Persisted checks, newest first' })).toBeInTheDocument());
    expect(screen.getAllByText('42 ms')).toHaveLength(2);
    expect(state.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(state.endpoints[0]!.baselineSchema).toBeNull();
  });

  it('shows an upstream failure as failed even though the API created a check record', async () => {
    const { state } = mockApi();
    state.nextCheck = check({ outcome: 'http_error', httpStatus: 503, errorCode: 'http_status' });
    const user = userEvent.setup();
    showDetail();
    await screen.findByText('No checks recorded');
    await user.click(screen.getByRole('button', { name: 'Run check' }));
    expect(await screen.findByText(/Check saved as failed: http_status/)).toBeInTheDocument();
    expect(await screen.findByText('Comparison unavailable for this check')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.getAllByText('503')).toHaveLength(2);
  });

  it('renders recorded added, removed, and type-changed fields and selects historical checks', async () => {
    mockApi({ endpoints: [endpoint({ baselineSchema: { types: ['object'] } })], checks: { [endpointId]: [
      check({ id: 'changed', outcome: 'schema_changed', schemaChanges: changes }),
      check({ id: 'old-failure', outcome: 'network_error', errorCode: 'timeout', httpStatus: null }),
    ] } });
    const user = userEvent.setup();
    showDetail();
    expect(await screen.findByText('$.products[].price')).toBeInTheDocument();
    for (const label of ['Added', 'Removed', 'Type changed', 'null | string', 'Absent']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'View changes for check old-failure' }));
    expect(screen.getByText('Comparison unavailable for this check')).toBeInTheDocument();
    expect(screen.queryByText('$.products[].price')).not.toBeInTheDocument();
    expect(screen.getAllByText('Schema changed')).toHaveLength(2); // Latest result does not change with selection.
  });

  it('disables checking for legacy endpoints outside the allowlist while preserving their history', async () => {
    mockApi({ endpoints: [endpoint({ url: 'https://example.com/api' })] });
    showDetail();
    await screen.findByText(/outside the current public test allowlist/);
    expect(screen.getByRole('button', { name: 'Run check' })).toBeDisabled();
    expect(screen.getByText('No checks recorded')).toBeInTheDocument();
  });

  it('disables duplicate actions while a manual check is pending', async () => {
    const { state, fetch } = mockApi();
    const original = fetch.getMockImplementation()!;
    let complete!: (response: Response) => void;
    fetch.mockImplementation(async (input, init) => {
      if (init?.method === 'POST' && String(input).includes('/checks')) {
        return new Promise<Response>(resolve => { complete = resolve; });
      }
      return original(input, init);
    });
    const user = userEvent.setup();
    showDetail();
    await screen.findByText('No checks recorded');
    await user.click(screen.getByRole('button', { name: 'Run check' }));
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Capture baseline' })).toBeDisabled();
    state.checks[endpointId] = [check()];
    await act(async () => complete(json({ check: check(), comparison: 'baseline_missing' }, 201)));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run check' })).toBeEnabled());
  });

  it('does not show empty history or enable mutations when history failed to load', async () => {
    const { state } = mockApi();
    state.failedHistory.add(endpointId);
    const user = userEvent.setup();
    showDetail();
    expect(await screen.findByRole('alert')).toHaveTextContent('database operation could not be confirmed');
    expect(screen.queryByText('No checks recorded')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run check' })).toBeDisabled();
    state.failedHistory.clear();
    await user.click(screen.getByRole('button', { name: 'Refresh detail' }));
    expect(await screen.findByText('No checks recorded')).toBeInTheDocument();
  });
});

describe('explicit baseline acceptance', () => {
  it('requires deliberate confirmation and submits the exact loaded updatedAt', async () => {
    const { state } = mockApi();
    const user = userEvent.setup();
    showDetail();
    await screen.findByText('No checks recorded');
    await user.click(screen.getByRole('button', { name: 'Capture baseline' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Accept baseline' })).toBeDisabled();
    expect(state.calls.some(call => call.method === 'PUT')).toBe(false);
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Accept baseline' }));
    expect(await screen.findByText(/Baseline accepted from a fresh response/)).toBeInTheDocument();
    expect(await screen.findByText('View saved schema')).toBeInTheDocument();
    expect(state.calls.find(call => call.method === 'PUT')?.body).toEqual({ accept: true, expectedUpdatedAt: initialTimestamp });
  });

  it('does not replace a saved baseline when confirmation is cancelled', async () => {
    const { state } = mockApi({ endpoints: [endpoint({ baselineSchema: { types: ['object'] } })] });
    const user = userEvent.setup();
    showDetail();
    await screen.findByText('View saved schema');
    await user.click(screen.getByRole('button', { name: 'Replace baseline' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Replace baseline' }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('refreshes stale acceptance, never auto-retries, and requires a new confirmation', async () => {
    const { state } = mockApi();
    state.baselineError = 'stale_baseline_acceptance';
    const user = userEvent.setup();
    showDetail();
    await screen.findByText('No checks recorded');
    await user.click(screen.getByRole('button', { name: 'Capture baseline' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Accept baseline' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Review the refreshed baseline and confirm again');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Capture baseline' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Capture baseline' }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Accept baseline' }));
    await screen.findByText('View saved schema');
    expect(state.calls.filter(call => call.method === 'PUT').map(call => call.body?.expectedUpdatedAt)).toEqual([initialTimestamp, nextTimestamp]);
  });

  it('shows a failed capture, reloads its saved failure, and retains the missing baseline', async () => {
    const { state } = mockApi();
    state.baselineError = 'baseline_capture_failed_check_saved';
    const user = userEvent.setup();
    showDetail();
    await screen.findByText('No checks recorded');
    await user.click(screen.getByRole('button', { name: 'Capture baseline' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Accept baseline' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The baseline was not changed');
    expect(await screen.findByText('Comparison unavailable for this check')).toBeInTheDocument();
    expect(state.endpoints[0]!.baselineSchema).toBeNull();
    expect(screen.getByRole('button', { name: 'Capture baseline' })).toBeEnabled();
  });
});
