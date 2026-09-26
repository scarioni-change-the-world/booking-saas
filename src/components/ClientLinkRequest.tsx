'use client';

import { useEffect, useState } from 'react';
import { ClientShell } from './booking/ClientShell';
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
    <ClientShell business={config ? { name: config.name, branding: config.branding } : null}>
      <div className="bk-solo">
        <div className="bk-panel">
          {sent ? (
            <section>
              <h1 className="bk-heading">Check your inbox</h1>
              <p className="bk-lede">{sent}</p>
              <p className="bk-after">
                <a className="bk-textlink" href={`/t/${slug}`}>
                  Back to booking
                </a>
              </p>
            </section>
          ) : (
            <form className="bk-form" onSubmit={submit}>
              <h1 className="bk-heading">Find your booking link</h1>
              <p className="bk-lede">
                If you&apos;ve booked with {config?.name ?? 'us'} before, your own link lets you book again
                without answering the questions. Enter your email and we&apos;ll send it over.
              </p>

              {error && (
                <p className="bk-error" role="alert">
                  {error}
                </p>
              )}

              <div className="field">
                <label htmlFor="client-email">Email</label>
                <input
                  id="client-email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <button type="submit" className="btn-primary btn-full" disabled={busy}>
                {busy ? 'Sending…' : 'Send my link'}
              </button>
              <p className="bk-after">
                <a className="bk-textlink" href={`/t/${slug}`}>
                  First time? Book from the start
                </a>
              </p>
            </form>
          )}
        </div>
      </div>
    </ClientShell>
  );
}
