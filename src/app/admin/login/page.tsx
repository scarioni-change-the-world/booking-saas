'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

/**
 * Sign in.
 *
 * No sign-up here — there is no self-serve account creation yet (see the
 * README roadmap); a tenant is currently linked to a login by hand, via
 * supabase/bootstrap/02_bootstrap_owner.sql. This page only authenticates.
 */
export default function AdminLoginPage() {
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

      const response = await fetch('/api/admin/me', {
        headers: { authorization: `Bearer ${data.session.access_token}` },
      });
      const body = (await response.json().catch(() => ({}))) as {
        tenants?: Array<{ slug: string }>;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? 'Could not sign in');

      const first = body.tenants?.[0];
      if (!first) {
        throw new Error(
          "You're signed in, but your account isn't linked to a business yet.",
        );
      }

      window.location.href = `/admin/${first.slug}/sessions`;
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="widget" style={{ paddingTop: 60 }}>
      <div className="brand-row" style={{ justifyContent: 'center' }}>
        <span className="admin-brand" style={{ fontSize: 28 }}>
          intro
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
