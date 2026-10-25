import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Notifications } from '../src/components/Notifications';
import { api } from '../src/api/client';
import { check, changes, endpointId, initialTimestamp, mockApi, nextTimestamp } from './fixtures';

async function setup() {
  const mock = mockApi(); const view = render(<Notifications id={endpointId} />);
  await screen.findByText('Saved notifications: Disabled');
  return { ...mock, ...view, user: userEvent.setup() };
}
const puts = (state: ReturnType<typeof mockApi>['state']) => state.calls.filter(call => call.method === 'PUT');
describe('persisted local notification controls', () => {
  it('keeps configuration usable when history cannot load', async () => {
    const { state } = mockApi(); state.notificationHistoryError = true;
    render(<Notifications id={endpointId} />); await screen.findByText('Saved notifications: Disabled');
    expect(screen.getByText(/Notification history unavailable/)).toBeVisible();
    expect(screen.getByLabelText('Enable local email notifications')).toBeEnabled();
    expect(screen.queryByText(/No notification events recorded/)).not.toBeInTheDocument();
  });
  it('loads disabled defaults without inventing events or dispatcher health', async () => {
    await setup(); expect(screen.getByLabelText('Enable local email notifications')).not.toBeChecked();
    expect(screen.getByText(/No notification events recorded/)).toBeVisible();
    expect(screen.getByText(/Sending requires the separate email dispatcher/)).toBeVisible();
  });
  it('requires confirmation, sends the saved version, and restores persisted preference', async () => {
    const { user, state, unmount } = await setup();
    await user.click(screen.getByLabelText('Enable local email notifications'));
    await user.click(screen.getByRole('button', { name: 'Save notifications' })); expect(puts(state)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Confirm notifications' }));
    await screen.findByText('Saved notifications: Enabled');
    expect(puts(state)[0]?.body).toEqual({ enabled: true, expectedUpdatedAt: null });
    unmount(); render(<Notifications id={endpointId} />); await screen.findByText('Saved notifications: Enabled');
  });
  it('cancels confirmation without writing and disables without removing history', async () => {
    const { user, state } = await setup();
    await user.click(screen.getByLabelText('Enable local email notifications')); await user.click(screen.getByRole('button', { name: 'Save notifications' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' })); expect(puts(state)).toHaveLength(0);
    state.notificationSettings[endpointId] = { endpointId, enabled: true, updatedAt: nextTimestamp };
    await user.click(screen.getByRole('button', { name: 'Refresh notifications' })); await screen.findByText('Saved notifications: Enabled');
    await user.click(screen.getByLabelText('Enable local email notifications')); await user.click(screen.getByRole('button', { name: 'Save notifications' }));
    await screen.findByText('Saved notifications: Disabled');
    expect(puts(state)[0]?.body).toEqual({ enabled: false, expectedUpdatedAt: nextTimestamp });
  });
  it('rejects stale settings without automatically retrying', async () => {
    const { user, state } = await setup();
    await user.click(screen.getByLabelText('Enable local email notifications')); await user.click(screen.getByRole('button', { name: 'Save notifications' }));
    state.notificationSettings[endpointId] = { endpointId, enabled: false, updatedAt: nextTimestamp };
    await user.click(screen.getByRole('button', { name: 'Confirm notifications' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed elsewhere'); expect(puts(state)).toHaveLength(1);
    expect(screen.queryByText('Notification settings saved.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh notifications' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
  it('prevents duplicate saves and reports unavailable configuration honestly', async () => {
    const { user, state } = await setup(); let finish!: () => void;
    const original = api.configureNotifications;
    vi.spyOn(api, 'configureNotifications').mockImplementation(async (...args) => { await new Promise<void>(resolve => { finish = resolve; }); return original(...args); });
    await user.click(screen.getByLabelText('Enable local email notifications')); await user.click(screen.getByRole('button', { name: 'Save notifications' }));
    await user.dblClick(screen.getByRole('button', { name: 'Confirm notifications' }));
    expect(api.configureNotifications).toHaveBeenCalledTimes(1); expect(screen.getByLabelText('Enable local email notifications')).toBeDisabled();
    finish(); await screen.findByText('Notification settings saved.'); expect(puts(state)).toHaveLength(1);
    state.notificationError = true; await user.click(screen.getByRole('button', { name: 'Refresh notifications' })); await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Save notifications' })).toBeDisabled();
  });
  it('renders stored incident/change metadata and SMTP acceptance without claiming delivery', async () => {
    const { state } = mockApi();
    state.notificationEvents[endpointId] = [{ id: 'event', kind: 'schema_changed', createdAt: initialTimestamp,
      incident: { id: 'incident', kind: 'schema', openedAt: initialTimestamp, closedAt: null, resolution: null }, checkResult: check({ schemaChanges: changes }),
      outbox: { state: 'smtp_accepted', attempts: 1, availableAt: initialTimestamp, finishedAt: nextTimestamp, lastErrorCode: null, deliveries: [{ number: 1, state: 'smtp_accepted', startedAt: initialTimestamp, finishedAt: nextTimestamp, errorCode: null }] } }];
    render(<Notifications id={endpointId} />);
    await screen.findByText('SMTP accepted (Mailpit)'); expect(screen.getByText('Open')).toBeVisible();
    await userEvent.setup().click(screen.getByText('View event')); expect(screen.getByText(/\$\.products\[\]\.price/)).toBeVisible();
    expect(screen.getByText(/SMTP acceptance does not prove delivery/)).toBeVisible();
  });
  it('keeps missing settings distinct from disabled configuration', async () => {
    const { state } = mockApi(); state.notificationError = true;
    render(<Notifications id={endpointId} />); await screen.findByText(/Notification settings unavailable/);
    expect(screen.queryByTestId('saved-notifications')).not.toBeInTheDocument();
  });
});
