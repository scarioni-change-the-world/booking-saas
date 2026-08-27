'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

/**
 * Sign in to the company console — a separate login from /admin/login on
 * purpose. Both authenticate the same way (the same Supabase project, the
 * same email and password), but they check different things afterward: this
 * one checks platform_staff, not any one business's tenant_members, and
 * sends someone who fails that check back here rather than into a random
 * business's dashboard.
 */
export default function ConsoleLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const { data, error: signInError } = await supabaseBrowser().auth.signInWithPassword({
        email,
        password,
      });
      if (signInError || !data.session) {
        throw new Error(signInError?.message ?? 'Could not sign in');
      }

      const response = await fetch('/api/console/me', {
        headers: { authorization: `Bearer ${data.session.access_token}` },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "You're signed in, but you're not on the company's staff list.");
      }

      window.location.href = '/console';
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="widget" style={{ paddingTop: 60 }}>
      <div className="brand-row" style={{ justifyContent: 'center' }}>
        <span className="admin-brand" style={{ fontSize: 28 }}>
          intro <span style={{ color: 'var(--muted)', fontSize: '0.6em' }}>console</span>
        </span>
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary btn-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
