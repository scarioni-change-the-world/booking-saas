'use client';

import { useEffect, useState } from 'react';
import { SignInLayout } from '@/components/SignInLayout';

/**
 * Ask for a reset link.
 *
 * The screen is built around the fact that the API deliberately will not say
 * whether the address has an account (see
 * src/app/api/admin/password-reset/route.ts). That silence only works if the
 * copy here is honest about it: the confirmation says "if that address has an
 * account", not "check your inbox", so somebody who typed the wrong address
 * and sees nothing arrive knows to try another one rather than sitting and
 * waiting for a message that was never sent.
 *
 * The form is replaced by the confirmation rather than sitting under it. A
 * form still standing there invites a second submit, and a second submit
 * spends one of the three that address gets in an hour.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Staff arrive from the console's sign-in; "back" should return them there.
  // Read after mounting, as this page is prerendered without the query.
  const [backTo, setBackTo] = useState('/admin/login');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('from') === 'console') {
      setBackTo('/console/login');
    }
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };

      // A 429 or a malformed address is a real answer and is shown. Anything
      // else that came back ok is the identical message, whoever asked.
      if (!response.ok) throw new Error(body.error ?? 'Could not send that link');

      setSent(body.message ?? 'Check your inbox.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <SignInLayout>
        <p className="signin-eyebrow">Check your email</p>
        <h1 className="signin-heading">On its way.</h1>
        <p className="signin-lede">{sent}</p>
        <p className="signin-lede">
          Nothing after a few minutes? Look in your spam folder, then try the
          address you signed up with.
        </p>
        <p className="signin-aside">
          <a href={backTo}>Back to sign in</a>
        </p>
      </SignInLayout>
    );
  }

  return (
    <SignInLayout>
      <p className="signin-eyebrow">Your account</p>
      <h1 className="signin-heading">Forgotten your password?</h1>
      <p className="signin-lede">
        Enter the address you sign in with and we&apos;ll send you a link for
        setting a new one.
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

        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary btn-full" disabled={busy}>
          {busy ? 'Sending…' : 'Send the link'}
        </button>
      </form>

      <p className="signin-aside">
        <a href={backTo}>Back to sign in</a>
      </p>
    </SignInLayout>
  );
}
