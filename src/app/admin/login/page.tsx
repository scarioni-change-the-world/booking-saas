'use client';

import { useState } from 'react';
import { PasswordField } from '@/components/PasswordField';
import { SignInLayout } from '@/components/SignInLayout';
import { supabaseBrowser } from '@/lib/supabase-browser';

/**
 * Sign in.
 *
 * Signing up is its own page (/admin/signup), linked below the form. A login
 * that signed up but whose business was never made — the email link opened
 * elsewhere, or not at all on a project that confirms addresses itself — is
 * finished here, on first sign-in.
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
        // Supabase's code for a login whose address was never confirmed.
        if (signInError?.code === 'email_not_confirmed') {
          throw new Error('Confirm your email first — open the link we sent when you signed up.');
        }
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
      if (first) {
        window.location.href = `/admin/${first.slug}/flow`;
        return;
      }

      /* Signed up, but the business was never made — the email link was
         not opened here, or this project confirms addresses by itself.
         Signing in finishes it. */
      const finished = await fetch('/api/signup/complete', {
        method: 'POST',
        headers: { authorization: `Bearer ${data.session.access_token}` },
      });
      const made = (await finished.json().catch(() => ({}))) as { slug?: string; error?: string };
      if (finished.ok && made.slug) {
        window.location.href = `/admin/${made.slug}/flow`;
        return;
      }
      throw new Error(
        finished.status === 404
          ? "You're signed in, but your account isn't linked to a business yet."
          : (made.error ?? 'Could not open your account.'),
      );
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
      <p className="signin-aside">
        New to intro? <a href="/admin/signup">Create an account</a> — 7 days free.
      </p>
    </SignInLayout>
  );
}
