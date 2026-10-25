import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MonitoringSettings } from '../src/components/MonitoringSettings';
import { CheckHistory } from '../src/components/CheckHistory';
import { api, ApiError } from '../src/api/client';
import { check, endpointId, mockApi, nextTimestamp } from './fixtures';

async function setup() {
  const mock = mockApi();
  const view = render(<MonitoringSettings id={endpointId} />);
  await screen.findByText(/Saved configuration: Disabled/);
  return { ...mock, ...view, user: userEvent.setup() };
}
const puts = (state: ReturnType<typeof mockApi>['state']) => state.calls.filter(call => call.method === 'PUT');

describe('persisted monitoring settings', () => {
  it('loads disabled defaults without claiming a live worker', async () => {
    await setup();
    expect(screen.getByText('Automatic checks require the monitoring worker to be running.')).toBeVisible();
    expect(screen.getByLabelText('Enable automatic monitoring')).not.toBeChecked();
    expect(screen.getByText('No scheduled result saved')).toBeVisible();
  });

  it('requires confirmation, saves enablement, and survives remount', async () => {
    const { user, state, unmount } = await setup();
    await user.click(screen.getByLabelText('Enable automatic monitoring'));
    await user.selectOptions(screen.getByLabelText('Frequency'), '5');
    await user.click(screen.getByRole('button', { name: 'Save monitoring settings' }));
    expect(puts(state)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Confirm enablement' }));
    await screen.findByText(/Saved configuration: Enabled · Every 5/);
    expect(puts(state)).toHaveLength(1);
    unmount(); render(<MonitoringSettings id={endpointId} />);
    await screen.findByText(/Saved configuration: Enabled · Every 5/);
    expect(screen.getByLabelText('Enable automatic monitoring')).toBeChecked();
  });

  it('cancels enablement without writing', async () => {
    const { user, state } = await setup();
    await user.click(screen.getByLabelText('Enable automatic monitoring'));
    await user.click(screen.getByRole('button', { name: 'Save monitoring settings' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(puts(state)).toHaveLength(0);
  });

  it('updates frequency and disables without deleting history', async () => {
    const { user, state } = await setup();
    await user.selectOptions(screen.getByLabelText('Frequency'), '30');
    await user.click(screen.getByRole('button', { name: 'Save monitoring settings' }));
    await screen.findByText(/Saved configuration: Disabled · Every 30/);
    state.schedules[endpointId]!.enabled = true;
    state.runs[endpointId] = [{ endpointId, checkResultId: 'saved', scheduledFor: nextTimestamp, checkResult: check() }];
    await user.click(screen.getByRole('button', { name: 'Refresh settings' }));
    await screen.findByText(/Saved configuration: Enabled/);
    await user.click(screen.getByLabelText('Enable automatic monitoring'));
    await user.click(screen.getByRole('button', { name: 'Save monitoring settings' }));
    await screen.findByText(/Saved configuration: Disabled · Every 30/);
    expect(state.runs[endpointId]).toHaveLength(1);
    expect(screen.getByText('Healthy')).toBeVisible();
  });

  it('detects a concurrent configuration update and does not overwrite it', async () => {
    const { user, state } = await setup();
    await user.selectOptions(screen.getByLabelText('Frequency'), '60');
    const current = await api.schedule(endpointId);
    state.schedules[endpointId] = { ...current, intervalMinutes: 5 };
    await user.click(screen.getByRole('button', { name: 'Save monitoring settings' }));
    await screen.findByText(/Settings changed elsewhere/);
    expect(puts(state)).toHaveLength(0);
    expect(screen.getByLabelText('Frequency')).toHaveValue('5');
  });

  it('reports failure with no success message and requires refresh', async () => {
    const { user, state } = await setup();
    state.scheduleError = true;
    await user.selectOptions(screen.getByLabelText('Frequency'), '5');
    await user.click(screen.getByRole('button', { name: 'Save monitoring settings' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Monitoring settings saved.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save monitoring settings' })).toBeDisabled();
    state.scheduleError = false;
    await user.click(screen.getByRole('button', { name: 'Refresh settings' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('blocks duplicate submissions while a save is pending', async () => {
    const { user, state } = await setup();
    let finish!: () => void;
    const original = api.configureSchedule;
    vi.spyOn(api, 'configureSchedule').mockImplementation(async (...args) => {
      await new Promise<void>(resolve => { finish = resolve; });
      return original(...args);
    });
    await user.selectOptions(screen.getByLabelText('Frequency'), '5');
    await user.dblClick(screen.getByRole('button', { name: 'Save monitoring settings' }));
    expect(api.configureSchedule).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Frequency')).toBeDisabled();
    finish(); await screen.findByText('Monitoring settings saved.');
    expect(puts(state)).toHaveLength(1);
  });

  it('handles missing configuration without claiming it is disabled', async () => {
    const { state } = mockApi(); state.scheduleError = true;
    render(<MonitoringSettings id={endpointId} />);
    await screen.findByText(/Monitoring settings unavailable/);
    expect(screen.queryByTestId('saved-schedule')).not.toBeInTheDocument();
  });

  it('reports a write lock conflict and never automatically retries it', async () => {
    const { user } = await setup();
    await user.selectOptions(screen.getByLabelText('Frequency'), '5');
    const configure = vi.spyOn(api, 'configureSchedule').mockRejectedValue(new ApiError(409, 'check_already_running'));
    await user.click(screen.getByRole('button', { name: 'Save monitoring settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A check is already running');
    expect(configure).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('saved-schedule')).toHaveTextContent('Every 15 minutes');
    expect(screen.queryByText('Monitoring settings saved.')).not.toBeInTheDocument();
  });

  it('does not claim success when a PUT succeeds but verification fails', async () => {
    const { user, state } = await setup();
    const original = api.configureSchedule;
    vi.spyOn(api, 'configureSchedule').mockImplementation(async (...args) => {
      const result = await original(...args); state.scheduleError = true; return result;
    });
    await user.selectOptions(screen.getByLabelText('Frequency'), '5');
    await user.click(screen.getByRole('button', { name: 'Save monitoring settings' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Monitoring settings saved.')).not.toBeInTheDocument();
    expect(state.schedules[endpointId]?.intervalMinutes).toBe(5);
  });

  it('keeps configuration usable when scheduled history is unavailable', async () => {
    const { state } = mockApi(); state.historyUnavailable = true;
    render(<MonitoringSettings id={endpointId} />);
    await screen.findByText(/Saved configuration: Disabled/);
    expect(screen.getByText('Unavailable')).toBeVisible();
    expect(screen.getByLabelText('Frequency')).toBeEnabled();
  });

  it('shows loading without an invented saved configuration', async () => {
    mockApi(); vi.spyOn(api, 'schedule').mockReturnValue(new Promise(() => {}));
    render(<MonitoringSettings id={endpointId} />);
    expect(screen.getByText('Loading saved monitoring settings…')).toBeVisible();
    expect(screen.queryByTestId('saved-schedule')).not.toBeInTheDocument();
  });

  it('labels actual scheduled and manual provenance, preserving unknown sources', () => {
    render(<CheckHistory checks={[check(), check({ id: 'scheduled', scheduledCheck: { scheduledFor: nextTimestamp } }), check({ id: 'unknown', scheduledCheck: undefined })]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText('Scheduled')).toBeVisible();
    expect(screen.getByText('Manual')).toBeVisible();
    expect(screen.getByText('Source unavailable')).toBeVisible();
  });
});
