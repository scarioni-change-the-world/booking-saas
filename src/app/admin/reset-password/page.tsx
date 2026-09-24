'use client';

import { useEffect, useState } from 'react';
import { PasswordField } from '@/components/PasswordField';
import { SignInLayout } from '@/components/SignInLayout';
import { supabaseBrowser } from '@/lib/supabase-browser';

/**
 * Set a new password, having arrived from the emailed link.
 *
 * How the link becomes a session: Supabase's recovery link goes to its own
 * /auth/v1/verify, which redirects here with the tokens in the URL *hash*.
 * supabase-js is configured for the implicit flow and reads that hash
 * itself on start-up — which is why this page waits on onAuthStateChange
 * rather than parsing anything. INITIAL_SESSION always fires once that
 * start-up finishes, with a session or with null, so it doubles as the
 * answer to "was that link any good?" without a timeout to guess at.
 *
 * The hash is then cleared from the address bar. Those tokens are a live
 * session; leaving them in the URL leaves them in browser history, in a
 * shared screen, and in whatever the person pastes when they ask for help.
 *
 * MIN_LENGTH is this app's own floor, above Supabase's default of six. It is
 * checked here to give an answer before a round trip, not instead of one:
 * whatever the project is configured to enforce is enforced server-side, and
 * its complaint is shown verbatim if it rejects something this let through.
 */

const MIN_LENGTH = 8;

type State = 'checking' | 'ready' | 'invalid' | 'unavailable';

export default function ResetPasswordPage() {
  const [state, setState] = useState<State>('checking');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Supabase puts a refusal — an expired or already-used link — in the same
    // hash it would have put the tokens in. Read before the hash is cleared,
    // and logged rather than shown: whichever refusal it is, the person's
    // next move is identical, and pasting Supabase's wording into the page
    // only stutters over what the heading already says. Support gets it
    // from the console; the alternative is matching on its prose, which is
    // exactly what generateRecoveryLink refuses to do and for good reason.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const refusal = hash.get('error_description') ?? hash.get('error');
    if (refusal) console.warn('[reset-password] link refused:', refusal);

    const clearHash = () => {
      window.history.replaceState(null, '', window.location.pathname);
    };

    // supabaseBrowser() throws outright when its two env vars are missing.
    // This is the only screen that calls it on mount rather than on submit,
    // so it is the only one where that throw takes the whole page down — and
    // a blank page is the worst possible answer to somebody who is already
    // locked out. Caught and named instead, as its own state: reporting a
    // misconfigured deployment as "that link has expired" would send them
    // round the loop again for a link that could never have worked.
    let subscription: { unsubscribe: () => void };
    try {
      const { data } = supabaseBrowser().auth.onAuthStateChange((event, session) => {
        if (session) {
          setState('ready');
          clearHash();
          return;
        }
        // Null session at INITIAL_SESSION means start-up finished and found
        // nothing usable in the URL. Later null events are sign-outs, which
        // are not this page's business.
        if (event === 'INITIAL_SESSION') {
          setState('invalid');
          clearHash();
        }
      });
      subscription = data.subscription;
    } catch (cause) {
      console.error('[reset-password] auth is not configured:', cause);
      setState('unavailable');
      return;
    }

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Please use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirmation) {
      setError("Those two don't match.");
      return;
    }

    setBusy(true);
    try {
      const supabase = supabaseBrowser();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);

      // Signed in already, on the strength of the recovery link — so the
      // same landing as a normal sign-in, rather than sending somebody back
      // to a form to type the password they just chose.
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Your password was changed, but the session did not carry over. Please sign in.');

      const response = await fetch('/api/admin/me', {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await response.json().catch(() => ({}))) as {
        tenants?: Array<{ slug: string }>;
        error?: string;
      };

      const first = response.ok ? body.tenants?.[0] : undefined;
      // The password change stuck either way, so never report this as a
      // failure to change it. Sign-in is where an unlinked account gets the
      // explanation it needs.
      window.location.href = first ? `/admin/${first.slug}/flow` : '/admin/login';
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  if (state === 'checking') {
    return (
      <SignInLayout>
        <p className="signin-eyebrow">Your account</p>
        <h1 className="signin-heading">One moment.</h1>
        <p className="signin-lede">Checking your link…</p>
      </SignInLayout>
    );
  }

  if (state === 'unavailable') {
    return (
      <SignInLayout>
        <p className="signin-eyebrow">Your account</p>
        <h1 className="signin-heading">We can&apos;t check that link.</h1>
        <p className="signin-lede">
          Something on our side isn&apos;t answering, so your link hasn&apos;t
          been used up — try it again in a few minutes. If it still fails,
          send us the address you sign in with and we&apos;ll sort it out.
        </p>
        <p className="signin-aside">
          <a href="/admin/login">Back to sign in</a>
        </p>
      </SignInLayout>
    );
  }

  if (state === 'invalid') {
    return (
      <SignInLayout>
        <p className="signin-eyebrow">Your account</p>
        <h1 className="signin-heading">That link has expired.</h1>
        <p className="signin-lede">
          Reset links last an hour and can only be used once. Ask for a fresh
          one and it will be with you in a moment.
        </p>
        <p className="signin-aside">
          <a href="/admin/forgot-password">Send me a new link</a>
        </p>
      </SignInLayout>
    );
  }

  return (
    <SignInLayout>
      <p className="signin-eyebrow">Your account</p>
      <h1 className="signin-heading">Choose a new password.</h1>
      <p className="signin-lede">
        Once you&apos;ve set it we&apos;ll take you straight to your dashboard.
      </p>

      <form className="signin-form" onSubmit={handleSubmit}>
        <PasswordField
          id="password"
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={`At least ${MIN_LENGTH} characters.`}
        />
        <PasswordField
          id="confirmation"
          label="New password again"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
        />

        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary btn-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save and sign in'}
        </button>
      </form>
    </SignInLayout>
  );
}
