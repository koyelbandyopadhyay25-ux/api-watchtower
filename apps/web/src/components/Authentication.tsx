import { createContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, authApi, clearAuthentication, errorMessage, type AuthenticatedSession } from '../api/client';
import { Notice } from './common';

export const AuthContext = createContext<{ email: string; logout: () => void; busy: boolean } | null>(null);

function SignIn({ onLogin }: { onLogin: (session: AuthenticatedSession) => void }) {
  const [registration, setRegistration] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    if ([...password].length < 12 || [...password].length > 128) { setError('Use a password with 12–128 characters.'); return; }
    lock.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      if (registration) {
        const result = await authApi.register(email, password);
        if (mounted.current) { setRegistration(false); setNotice(result.message); }
      } else {
        const result = await authApi.login(email, password);
        if (mounted.current) onLogin(result);
      }
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { lock.current = false; if (mounted.current) { setBusy(false); setPassword(''); } }
  }
  return <main className="auth-page"><div className="auth-container"><a className="wordmark" href="#endpoints"><span>API</span> Watchtower</a><section className="panel" aria-labelledby="auth-heading">
    <div className="panel-heading"><h1 id="auth-heading">{registration ? 'Create a local account' : 'Sign in'}</h1></div>
    <form className="auth-form" onSubmit={event => void submit(event)} aria-busy={busy}>
      <p className="small muted">Local development only. Existing unclaimed monitoring records are not assigned to new accounts.</p>
      {error && <Notice tone="error">{error}</Notice>}{notice && <Notice>{notice}</Notice>}
      <label htmlFor="auth-email">Email</label><input id="auth-email" type="email" autoComplete="username" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} />
      <label htmlFor="auth-password">Password</label><input id="auth-password" type="password" autoComplete={registration ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} aria-describedby="password-help" />
      <p id="password-help" className="small muted">12–128 characters. Passwords are never saved in browser storage.</p>
      <div className="actions form-actions"><button className="text-button" type="button" disabled={busy} onClick={() => { setRegistration(value => !value); setError(null); setNotice(null); setPassword(''); }}>{registration ? 'Back to sign in' : 'Create account'}</button><button className="button button-primary" disabled={busy}>{busy ? 'Please wait…' : registration ? 'Register' : 'Sign in'}</button></div>
    </form></section></div></main>;
}

export function Authentication({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthenticatedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    const expired = () => { setSession(null); clearAuthentication(); };
    window.addEventListener('watchtower:session-expired', expired);
    return () => window.removeEventListener('watchtower:session-expired', expired);
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => { setSession(null); clearAuthentication(); }, Math.max(0, Math.min(2_147_483_647, Date.parse(session.expiresAt) - Date.now())));
    return () => clearTimeout(timer);
  }, [session]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    void authApi.session(controller.signal).then(value => {
      if (!controller.signal.aborted) setSession(value);
    }).catch(failure => {
      if (!controller.signal.aborted && !(failure instanceof ApiError && failure.status === 401)) setError(errorMessage(failure));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  async function logout() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await authApi.logout(); setSession(null); }
    catch (failure) { if (!(failure instanceof ApiError && failure.status === 401)) setError(errorMessage(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  if (loading) return <main className="auth-page" role="status">Restoring your session…</main>;
  if (error && !session) return <main className="auth-page"><div className="auth-container"><Notice tone="error">{error}</Notice><button className="button" onClick={() => setRevision(value => value + 1)}>Retry session</button></div></main>;
  if (!session) return <SignIn onLogin={value => { setError(null); setSession(value); }} />;
  return <AuthContext.Provider value={{ email: session.user.email, logout: () => void logout(), busy }}>{error && <Notice tone="error">{error}</Notice>}{children}</AuthContext.Provider>;
}
