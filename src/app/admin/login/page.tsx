'use client';

import { useState } from 'react';
import { PasswordField } from '@/components/PasswordField';
import { SignInLayout } from '@/components/SignInLayout';
import { supabaseBrowser } from '@/lib/supabase-browser';

/**
 * Sign in.
 *
 * No sign-up here — there is no self-serve account creation yet (see the
 * README roadmap); a tenant is currently linked to a login by hand, via
 * supabase/bootstrap/02_bootstrap_owner.sql. This page only authenticates,
 * which is why there is no "Create account" link below the form.
 *
 * There is a "Forgot your password?" link, and it goes somewhere real —
 * /admin/forgot-password and /admin/reset-password are the other two halves
 * of this journey.
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
    <SignInLayout>
      <p className="signin-eyebrow">Your account</p>
      <h1 className="signin-heading">Welcome back.</h1>
      <p className="signin-lede">
        Sign in to manage your services, bookings and client enquiries.
      </p>

      <form className="signin-form" onSubmit={handleSubmit}>
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

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />

        {/* Rendered immediately before the button that produced it, and
            announced when it appears. Form-level rather than attached to a
            field: a wrong password is not a fault in the email box or the
            password box on its own, and pinning it to one would point at the
            wrong thing. */}
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary btn-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="signin-aside">
        <a href="/admin/forgot-password">Forgot your password?</a>
      </p>
    </SignInLayout>
  );
}
