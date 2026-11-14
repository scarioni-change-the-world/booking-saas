'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { qrSource } from '@/lib/qr-source';

type Step = 'password' | 'code' | 'enrol';

interface Me {
  role: string;
  twoStepNeeded: boolean;
}

interface Enrolment {
  factorId: string;
  qr: string;
  secret: string;
}

/**
 * Sign in to the company console — a separate login from the business sign-in (/) on
 * purpose. Both authenticate the same way (the same Supabase project, the
 * same email and password), but they check different things afterward: this
 * one checks platform_staff, not any one business's tenant_members, and
 * sends someone who fails that check back here rather than into a random
 * business's dashboard.
 *
 * A console owner signs in in two steps: the password, then a six-digit code
 * from an authenticator app (Supabase MFA). The first time, they set the app
 * up here: scan the code, type one code back. The server refuses an owner's
 * requests without the second step (requirePlatformStaff), so this screen is
 * the way through, not the lock.
 */
export default function ConsoleLoginPage() {
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Who this is, once signed in with the password. */
  async function whoAmI(token: string): Promise<Me> {
    const response = await fetch('/api/console/me', { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "You're signed in, but you're not on the company's staff list.");
    }
    return (await response.json()) as Me;
  }

  /** On to the console, or to the second step for an owner who still needs it. */
  async function next(me: Me) {
    if (!me.twoStepNeeded) {
      window.location.href = '/console';
      return;
    }
    const mfa = supabaseBrowser().auth.mfa;
    const { data, error: listError } = await mfa.listFactors();
    if (listError) throw listError;
    const verified = data.totp.find((f) => f.status === 'verified');
    if (verified) {
      setFactorId(verified.id);
      setStep('code');
      return;
    }
    // First time: clear any half-finished set-up, then start a new one.
    for (const f of data.all.filter((f) => f.factor_type === 'totp' && f.status !== 'verified')) {
      await mfa.unenroll({ factorId: f.id });
    }
    const enrolled = await mfa.enroll({ factorType: 'totp', friendlyName: 'khloe console' });
    if (enrolled.error) throw enrolled.error;
    setEnrolment({ factorId: enrolled.data.id, qr: qrSource(enrolled.data.totp.qr_code), secret: enrolled.data.totp.secret });
    setFactorId(enrolled.data.id);
    setStep('enrol');
  }

  // Sent back here from the console for the second step: pick up the session.
  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabaseBrowser().auth.getSession();
        if (!data.session) return;
        const me = await whoAmI(data.session.access_token);
        if (me.twoStepNeeded) await next(me);
      } catch {
        /* Not signed in, or not staff: the password form is the way in. */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data, error: signInError } = await supabaseBrowser().auth.signInWithPassword({ email, password });
      if (signInError || !data.session) throw new Error(signInError?.message ?? 'Could not sign in');
      await next(await whoAmI(data.session.access_token));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCode(event: React.FormEvent) {
    event.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabaseBrowser().auth.mfa.challengeAndVerify({
        factorId,
        code: code.replace(/\s/g, ''),
      });
      if (verifyError) throw new Error('That code did not work. Codes change every 30 seconds: try the current one.');
      window.location.href = '/console';
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  async function startOver() {
    await supabaseBrowser().auth.signOut();
    setStep('password');
    setCode('');
    setEnrolment(null);
    setError(null);
  }

  return (
    /* Same textured ground as the tenant sign-in — see globals.css. */
    <div className="admin-app signin-ground">
      <main className="widget" style={{ paddingTop: 88 }}>
        <div className="brand-row" style={{ justifyContent: 'center' }}>
          <span className="admin-brand" style={{ fontSize: 28 }}>
            khloe <span className="console-mark">console</span>
          </span>
        </div>
        <p className="admin-eyebrow" style={{ textAlign: 'center', marginBottom: 26 }}>
          {step === 'password' ? 'Staff access' : 'Two-step sign-in'}
        </p>

        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        {step === 'password' && (
          <form onSubmit={handlePassword}>
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
        )}

        {step === 'enrol' && enrolment && (
          <div className="mfa-enrol">
            <p className="signin-lede">
              As a console owner you sign in with your password and a code from an authenticator app (Google
              Authenticator, 1Password, Authy…). Set it up once:
            </p>
            <p className="mfa-step">1. In the app, add an account and scan this code.</p>
            {/* Supabase returns the QR code as an SVG data address. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="mfa-qr"
              src={enrolment.qr}
              alt="QR code to add khloe console to your authenticator app"
              width={180}
              height={180}
            />
            <p className="field-note mfa-secret">
              Can’t scan? Enter this key instead: <code>{enrolment.secret}</code>
            </p>
            <p className="mfa-step">2. Type the six-digit code the app shows.</p>
          </div>
        )}

        {(step === 'code' || step === 'enrol') && (
          <form onSubmit={handleCode}>
            {step === 'code' && <p className="signin-lede">Enter the six-digit code from your authenticator app.</p>}
            <div className="field">
              <label htmlFor="code">Code</label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn-primary btn-full"
              disabled={busy || code.replace(/\s/g, '').length !== 6}
            >
              {busy ? 'Checking…' : step === 'enrol' ? 'Turn on and sign in' : 'Sign in'}
            </button>
            <p className="signin-aside">
              <button type="button" className="signin-textbutton" onClick={() => void startOver()}>
                Sign in as someone else
              </button>
            </p>
          </form>
        )}

        {step === 'password' && (
          /* The same reset as a business owner's; the reset page brings
              staff back to the console afterwards. */
          <p className="signin-aside">
            <a href="/admin/forgot-password?from=console">Forgot your password?</a>
          </p>
        )}
      </main>
    </div>
  );
}
