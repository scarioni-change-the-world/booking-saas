'use client';

import { useEffect, useRef, useState } from 'react';
import { PasswordField } from '@/components/PasswordField';
import { SignInLayout } from '@/components/SignInLayout';
import { PASSWORD_MIN, signupProblem, slugFromName } from '@/lib/signup';

type Address =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'free' }
  | { state: 'taken'; suggestion?: string }
  | { state: 'reserved' }
  | { state: 'invalid' };

function detectedZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  } catch {
    return 'Europe/London';
  }
}

/**
 * Create an account.
 *
 * Four things and a time zone, because a business with a name and a web
 * address is enough to start: everything else — services, hours, questions —
 * is set up inside, where each one shows its effect. The web address follows
 * the name until somebody edits it, and says as they type whether it is free.
 *
 * Nothing is made until the email link is opened (see /api/signup), so the
 * last screen here is "check your inbox", not the dashboard.
 */
export default function SignupPage() {
  const [businessName, setBusinessName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [timezone, setTimezone] = useState('Europe/London');
  const [zones, setZones] = useState<string[]>([]);
  const [changingZone, setChangingZone] = useState(false);
  const [address, setAddress] = useState<Address>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    setTimezone(detectedZone());
    try {
      setZones(Intl.supportedValuesOf('timeZone'));
    } catch {
      setZones([detectedZone()]);
    }
  }, []);

  // The address follows the name until it is edited by hand.
  useEffect(() => {
    if (!slugEdited) setSlug(slugFromName(businessName));
  }, [businessName, slugEdited]);

  // Is it free? Asked a moment after typing stops, and only the latest answer counts.
  useEffect(() => {
    if (!slug) {
      setAddress({ state: 'idle' });
      return;
    }
    const n = ++asked.current;
    setAddress({ state: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/signup/address?slug=${encodeURIComponent(slug)}`);
        const body = (await response.json()) as { available: boolean; reason?: string; suggestion?: string };
        if (n !== asked.current) return;
        if (body.available) setAddress({ state: 'free' });
        else if (body.reason === 'taken') setAddress({ state: 'taken', suggestion: body.suggestion });
        else if (body.reason === 'reserved') setAddress({ state: 'reserved' });
        else setAddress({ state: 'invalid' });
      } catch {
        if (n === asked.current) setAddress({ state: 'idle' });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [slug]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const problem = signupProblem({ businessName, slug, email, password });
    if (problem) {
      setError(problem);
      return;
    }
    if (address.state === 'taken') {
      setError('A business already has that web address. Choose another.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessName: businessName.trim(),
          slug,
          email: email.trim(),
          password,
          timezone,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { email?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not create your account. Please try again.');
      setSentTo(body.email ?? email.trim());
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <SignInLayout>
        <p className="signin-eyebrow">Almost there</p>
        <h1 className="signin-heading">Check your inbox.</h1>
        <p className="signin-lede">
          We’ve sent a link to <b>{sentTo}</b>. Open it to confirm your address and {businessName.trim()} is
          ready. It works once, for 24 hours.
        </p>
        <p className="signin-aside">
          Nothing arrived after a few minutes? Check spam, or{' '}
          <button type="button" className="signin-textbutton" onClick={() => setSentTo(null)}>
            go back and check the address
          </button>
          .
        </p>
      </SignInLayout>
    );
  }

  const origin = typeof window === 'undefined' ? '' : window.location.host;

  return (
    <SignInLayout>
      <p className="signin-eyebrow">Create an account</p>
      <h1 className="signin-heading">Start taking bookings.</h1>
      <p className="signin-lede">
        7 days free. No card needed. Set up your services and share your page today.
      </p>

      <form className="signin-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="business">Your business’s name</label>
          <input
            id="business"
            type="text"
            required
            autoComplete="organization"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="slug">Your booking page’s address</label>
          <div className="signin-address">
            <span className="signin-address__prefix" aria-hidden="true">
              {origin}/t/
            </span>
            <input
              id="slug"
              type="text"
              required
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="slug-state"
              value={slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
              }}
            />
          </div>
          <p
            className={`signin-hint${address.state === 'taken' || address.state === 'reserved' ? ' is-need' : ''}`}
            id="slug-state"
            aria-live="polite"
          >
            {address.state === 'checking' && 'Checking…'}
            {address.state === 'free' && 'Free — this is yours if you want it. It can’t be changed later.'}
            {address.state === 'reserved' && 'That one is kept for intro itself. Choose another.'}
            {address.state === 'invalid' &&
              'Lowercase letters, numbers and single dashes, at least 3 characters.'}
            {address.state === 'taken' && (
              <>
                A business already has it.
                {address.suggestion && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="signin-textbutton"
                      onClick={() => {
                        setSlugEdited(true);
                        setSlug(address.suggestion!);
                      }}
                    >
                      Use {address.suggestion}
                    </button>
                  </>
                )}
              </>
            )}
            {address.state === 'idle' && 'Where clients book you. It can’t be changed later.'}
          </p>
        </div>

        <div className="field">
          <label htmlFor="email">Your email</label>
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
          label="Choose a password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN} characters.`}
        />

        <div className="field">
          {changingZone ? (
            <>
              <label htmlFor="zone">Time zone</label>
              <select id="zone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p className="signin-hint" style={{ margin: 0 }}>
              Your hours will be in {timezone.replace(/_/g, ' ')}.{' '}
              <button type="button" className="signin-textbutton" onClick={() => setChangingZone(true)}>
                Change
              </button>
            </p>
          )}
        </div>

        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary btn-full" disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </button>
        <p className="signin-hint" style={{ textAlign: 'center' }}>
          By creating an account you agree to how we handle data, set out in our{' '}
          <a href="/privacy">privacy policy</a>.
        </p>
      </form>

      <p className="signin-aside">
        Already have an account? <a href="/admin/login">Sign in</a>
      </p>
    </SignInLayout>
  );
}
