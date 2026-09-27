'use client';

import { useEffect, useRef, useState } from 'react';
import { SignInLayout } from '@/components/SignInLayout';
import { supabaseBrowser } from '@/lib/supabase-browser';

type State = 'checking' | 'opening' | 'invalid' | 'failed';

/**
 * Where the sign-up email's link lands. Supabase has confirmed the address
 * and put a session in the URL; this makes the business the form asked for
 * (/api/signup/complete) and opens it.
 */
export default function WelcomePage() {
  const [state, setState] = useState<State>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const refusal = hash.get('error_description') ?? hash.get('error');
    if (refusal) console.warn('[welcome] link refused:', refusal);

    async function finish(token: string) {
      // Both INITIAL_SESSION and SIGNED_IN can carry the session; one business, one call.
      if (started.current) return;
      started.current = true;
      setState('opening');
      try {
        const response = await fetch('/api/signup/complete', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        });
        const body = (await response.json().catch(() => ({}))) as { slug?: string; error?: string };
        if (!response.ok || !body.slug) throw new Error(body.error ?? 'We could not open your account.');
        window.location.replace(`/admin/${body.slug}/flow`);
      } catch (cause) {
        setMessage((cause as Error).message);
        setState('failed');
      }
    }

    let unsubscribe = () => {};
    try {
      const { data } = supabaseBrowser().auth.onAuthStateChange((event, session) => {
        if (session) {
          window.history.replaceState(null, '', window.location.pathname);
          void finish(session.access_token);
          return;
        }
        if (event === 'INITIAL_SESSION') setState('invalid');
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch (cause) {
      console.error('[welcome] auth is not configured:', cause);
      setMessage('Signing in is not set up on this deployment.');
      setState('failed');
    }
    return unsubscribe;
  }, []);

  return (
    <SignInLayout>
      {(state === 'checking' || state === 'opening') && (
        <>
          <p className="signin-eyebrow">Welcome</p>
          <h1 className="signin-heading">{state === 'opening' ? 'Opening your account…' : 'One moment…'}</h1>
          <p className="signin-lede" role="status">
            Your address is confirmed. Setting up your business.
          </p>
        </>
      )}
      {state === 'invalid' && (
        <>
          <p className="signin-eyebrow">Welcome</p>
          <h1 className="signin-heading">That link has been used or has expired.</h1>
          <p className="signin-lede">
            If you already opened it, your account is ready — sign in with the email and password you chose.
            If not, sign up again and we’ll send a fresh link.
          </p>
          <p className="signin-aside">
            <a href="/admin/login">Sign in</a> · <a href="/admin/signup">Sign up again</a>
          </p>
        </>
      )}
      {state === 'failed' && (
        <>
          <p className="signin-eyebrow">Welcome</p>
          <h1 className="signin-heading">Your account isn’t open yet.</h1>
          <p className="signin-error" role="alert">
            {message}
          </p>
          <p className="signin-aside">
            <a href="/admin/login">Try signing in</a> — that finishes it too.
          </p>
        </>
      )}
    </SignInLayout>
  );
}
