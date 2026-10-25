import { useContext } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Authentication, AuthContext } from '../src/components/Authentication';
import { api } from '../src/api/client';
import { json } from './fixtures';

const session = { user: { id: 'test-user', email: 'person@example.test' }, csrfToken: 'c'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' };
function Private() {
  const auth = useContext(AuthContext)!;
  return <><p>Private dashboard</p><button disabled={auth.busy} onClick={auth.logout}>Sign out</button></>;
}
function fixture(logged = false) {
  const state = { logged, failLogin: false, failLogout: false, loginCalls: 0, registrations: 0 };
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/auth/session')) return state.logged ? json(session) : json({ error: 'authentication_required' }, 401);
    if (path.endsWith('/auth/register')) { state.registrations++; return json({ message: 'Registration request processed. You can now try signing in.' }, 202); }
    if (path.endsWith('/auth/login')) { state.loginCalls++; if (state.failLogin) return json({ error: 'invalid_credentials' }, 401); state.logged = true; return json(session); }
    if (path.endsWith('/auth/logout')) {
      expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe(session.csrfToken);
      if (state.failLogout) return json({ error: 'database_unavailable' }, 503);
      state.logged = false; return json({ ok: true });
    }
    return json({ error: 'authentication_required' }, 401);
  });
  vi.stubGlobal('fetch', fetch);
  return { state, fetch, user: userEvent.setup() };
}
async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), session.user.email);
  await user.type(screen.getByLabelText('Password'), 'Test-only password of sufficient length');
}
describe('authenticated dashboard boundary', () => {
  it('restores a real session before displaying protected content', async () => {
    fixture(true); render(<Authentication><Private /></Authentication>);
    expect(screen.queryByText('Private dashboard')).not.toBeInTheDocument();
    expect(await screen.findByText('Private dashboard')).toBeVisible();
  });
  it('logs in, sends cookie credentials and CSRF on logout, then removes private content', async () => {
    const { user, fetch } = fixture(); render(<Authentication><Private /></Authentication>);
    await screen.findByLabelText('Email'); await fill(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Private dashboard');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByLabelText('Email');
    expect(screen.queryByText('Private dashboard')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ credentials: 'same-origin' }));
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
  it('registers explicitly without automatically creating a session', async () => {
    const { user, state } = fixture(); render(<Authentication><Private /></Authentication>);
    await screen.findByLabelText('Email'); await user.click(screen.getByRole('button', { name: 'Create account' })); await fill(user);
    await user.click(screen.getByRole('button', { name: 'Register' }));
    await screen.findByText('Registration request processed. You can now try signing in.');
    expect(state.registrations).toBe(1); expect(state.logged).toBe(false); expect(screen.getByLabelText('Password')).toHaveValue('');
  });
  it('reports incorrect credentials without exposing protected data', async () => {
    const { user, state } = fixture(); state.failLogin = true;
    render(<Authentication><Private /></Authentication>); await screen.findByLabelText('Email'); await fill(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.queryByText('Private dashboard')).not.toBeInTheDocument();
  });
  it('restores across remounts and handles a subsequent server-side expiry', async () => {
    const { state } = fixture(true); const first = render(<Authentication><Private /></Authentication>); await screen.findByText('Private dashboard');
    first.unmount(); render(<Authentication><Private /></Authentication>); await screen.findByText('Private dashboard');
    state.logged = false;
    await act(async () => { await api.get('endpoint').catch(() => {}); });
    await screen.findByLabelText('Email'); expect(screen.queryByText('Private dashboard')).not.toBeInTheDocument();
  });
  it('does not display successful logout when revocation fails', async () => {
    const { user, state } = fixture(true); state.failLogout = true;
    render(<Authentication><Private /></Authentication>); await screen.findByText('Private dashboard');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('alert'); expect(screen.getByText('Private dashboard')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled());
  });
});
