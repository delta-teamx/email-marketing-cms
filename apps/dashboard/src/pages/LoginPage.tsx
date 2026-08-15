import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/ui';

type Mode = 'signin' | 'signup';

export function LoginPage() {
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="fullpage-center">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (session) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) setError(err.message);
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) {
          setError(err.message);
        } else if (!data.session) {
          setNotice('Account created. Check your inbox for a confirmation link, then sign in.');
          setMode('signin');
        }
        // If email confirmation is disabled, signUp returns a session and the
        // auth listener redirects automatically.
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fullpage-center login-page">
      <div className="auth-card">
        <div className="wordmark wordmark-large">
          <span className="wordmark-mark" aria-hidden="true">
            ▮
          </span>
          <span>
            Implenix <em>Marketing</em>
          </span>
        </div>
        <p className="auth-sub">
          {mode === 'signin'
            ? 'Sign in to manage your booking funnel.'
            : 'Create an account — a workspace is provisioned for you automatically.'}
        </p>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            className={mode === 'signin' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => {
              setMode('signin');
              setError(null);
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={mode === 'signup' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={onSubmit} className="auth-form">
          <label className="field">
            <span className="field-label">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={8}
              required
            />
          </label>

          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {notice && <div className="notice-banner">{notice}</div>}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
