'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

/**
 * Sign in.
 *
 * No sign-up here — there is no self-serve account creation yet (see the
 * README roadmap); a tenant is currently linked to a login by hand, via
 * supabase/bootstrap/02_bootstrap_owner.sql. This page only authenticates.
 * That is also why there is no "Create account" link below the form and no
 * "Forgot your password?" one: neither journey exists, and a link to a
 * journey that does not exist is worse than its absence.
 *
 * Visually this is the marketing site's doorstep — its closing image, under
 * its closing line — so arriving from the website's "Sign in" reads as a
 * continuation rather than a change of address. See .signin-split in
 * globals.css. Nothing below the markup changed when that arrived: the same
 * Supabase call, the same membership check, the same redirect.
 */

/**
 * Where "Back to the Intro website" goes.
 *
 * Read from the environment rather than hard-coded, because the marketing
 * site has no final domain yet — the product name is still being decided.
 * When it is unset the link is not rendered at all. A dead link back to the
 * website would undo exactly the continuity this page exists to create.
 */
const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL;
const SUPPORT_EMAIL = 'hello.intro.booking@gmail.com';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="signin-split">
      <main className="signin-panel">
        <div className="signin-column">
          {/* A span, not an h1: the heading of this page is "Welcome back."
              The wordmark says whose door this is, which is a different job. */}
          <span className="signin-wordmark">intro</span>

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

            <div className="field signin-password">
              <label htmlFor="password">Password</label>
              {/* The wrapper exists so the reveal is positioned against the
                  input alone. Against the whole field it lands level with
                  the label instead of inside the box. */}
              <div className="signin-password__control">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {/* type="button" matters: inside a form, a bare <button>
                    submits, and revealing the password would try to sign in. */}
                <button
                  type="button"
                  className="signin-reveal"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {/* Rendered immediately before the button that produced it, and
                announced when it appears. */}
            {error && (
              <p className="signin-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary btn-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="signin-foot">
            {MARKETING_URL && (
              <p>
                <a href={MARKETING_URL}>Back to the Intro website</a>
              </p>
            )}
            <p>
              Need help accessing your account? Contact{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </p>
          </div>
        </div>
      </main>

      {/* Second in the DOM, first on screen — see .signin-split. The picture
          is decorative and hidden from assistive tech; the line over it is
          not, so it stays readable. */}
      <aside className="signin-scene">
        <img
          className="signin-scene__image"
          src="/images/two-chair-lounge.webp"
          alt=""
          width={1448}
          height={1086}
          aria-hidden="true"
        />
        <div className="signin-scene__shade" aria-hidden="true" />
        <div className="signin-scene__words">
          <p className="signin-scene__line">Manage the booking. Improve the meeting.</p>
          <p className="signin-scene__sub">
            Your services, availability and client context in one place.
          </p>
        </div>
      </aside>
    </div>
  );
}
