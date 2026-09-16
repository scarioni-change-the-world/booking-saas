'use client';

import { useEffect, useState } from 'react';
import { accentStyle, initials } from './brand';
import { useAutoResize } from './useAutoResize';
import type { PublicConfig } from './types';

interface Props {
  slug: string;
}

/**
 * "Send me my booking link again."
 *
 * For a client who has the relationship but has lost the email — the one
 * failure mode a link-is-the-credential design has, and the reason this
 * page exists rather than leaving them to ask the business directly (which
 * they still can, and which is often faster: see .../clients/[id]/invite).
 *
 * Shows the same confirmation whether or not the address is on file. The
 * server says nothing either way (see /api/t/[slug]/client-link), so there
 * is nothing here to accidentally reveal by rendering it differently.
 */
export default function ClientLinkRequest({ slug }: Props) {
  useAutoResize();

  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/t/${encodeURIComponent(slug)}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${base}/config`);
        if (!response.ok) return;
        const body = (await response.json()) as PublicConfig;
        if (!cancelled) setConfig(body);
      } catch {
        // Branding is decoration here; the form works without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${base}/client-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Request failed');
      setSent(body.message ?? 'Check your inbox.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="widget" style={accentStyle(config?.branding.accentColor)}>
      {config && (
        <div className="brand-row">
          <div className="brand-mark">
            {config.branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied, arbitrary remote host
              <img src={config.branding.logoUrl} alt="" />
            ) : (
              initials(config.name)
            )}
          </div>
          <span className="brand-name">{config.name}</span>
        </div>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {sent ? (
        <>
          <h2>Check your inbox</h2>
          <p className="notice notice-muted">{sent}</p>
        </>
      ) : (
        <form onSubmit={submit}>
          <h2>Find your booking link</h2>
          <p className="lede">
            If you&apos;ve booked with us before, your own link lets you book again without
            answering the questions. Enter your email and we&apos;ll send it over.
          </p>

          <div className="field">
            <label htmlFor="client-email">
              Email<span className="required">*</span>
            </label>
            <input
              id="client-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary btn-full" disabled={busy}>
            {busy ? 'Sending…' : 'Send my link'}
          </button>
        </form>
      )}

      <p className="footer-credit">Powered by intro</p>
    </main>
  );
}
