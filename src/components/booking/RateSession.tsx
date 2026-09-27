'use client';

import { useEffect, useState } from 'react';
import { ClientShell, type ShellBusiness } from './ClientShell';

interface Loaded {
  business: ShellBusiness;
  serviceName: string;
  startsAt: string;
  clientName: string;
  state: 'open' | 'not_yet' | 'closed' | 'cancelled';
  rating: { rating: number; comment: string | null } | null;
}

const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/**
 * How was it? Five keys and a box. The answer goes to the business — only
 * them — and into Reports, where it is read by service.
 */
export default function RateSession({ token }: { token: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetch(`/api/rate/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const body = (await r.json()) as Loaded;
        setData(body);
        if (body.rating) {
          setRating(body.rating.rating);
          setComment(body.rating.comment ?? '');
        }
      })
      .catch(() => setMissing(true));
  }, [token]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!rating) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/rate/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'That did not go through. Please try again.');
      setSent(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const when = data
    ? new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(
        new Date(data.startsAt),
      )
    : '';

  return (
    <ClientShell business={data?.business ?? null}>
      <div className="bk-solo">
        <div className="bk-panel">
          <section className="bk-steps">
            {missing && (
              <>
                <h1 className="bk-heading">We can’t find that session</h1>
                <p className="bk-lede">The link may be incomplete. Try opening it from the email again.</p>
              </>
            )}
            {!missing && !data && <p className="bk-status">Loading…</p>}

            {data && sent && (
              <>
                <h1 className="bk-heading">Thank you</h1>
                <p className="bk-lede">
                  {data.business.name} will see what you said. It helps them make every session better.
                </p>
              </>
            )}

            {data && !sent && data.state === 'open' && (
              <form onSubmit={send}>
                <h1 className="bk-heading">How was your {data.serviceName}?</h1>
                <p className="bk-lede">
                  With {data.business.name}, {when}.
                </p>
                <div className="bk-rate" role="radiogroup" aria-label="Your rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={rating === n}
                      className={`bk-rate-key${rating !== null && n <= rating ? ' is-on' : ''}`}
                      onClick={() => setRating(n)}
                    >
                      <span className="bk-rate-star" aria-hidden="true">
                        ★
                      </span>
                      <span className="bk-rate-word">{WORDS[n]}</span>
                    </button>
                  ))}
                </div>
                <div className="field bk-form" style={{ marginTop: 18 }}>
                  <label htmlFor="rate-comment">Anything you’d like them to know? (optional)</label>
                  <textarea
                    id="rate-comment"
                    rows={3}
                    maxLength={2000}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </div>
                {error && (
                  <p className="notice notice-error" role="alert">
                    {error}
                  </p>
                )}
                <button type="submit" className="btn-primary btn-full" disabled={!rating || busy}>
                  {busy ? 'Sending…' : data.rating ? 'Update my rating' : 'Send'}
                </button>
                <p className="bk-privacy">Only {data.business.name} sees this.</p>
              </form>
            )}

            {data && !sent && data.state === 'not_yet' && (
              <>
                <h1 className="bk-heading">It hasn’t happened yet</h1>
                <p className="bk-lede">
                  Your {data.serviceName} is on {when}. You can rate it after.
                </p>
              </>
            )}
            {data && !sent && (data.state === 'closed' || data.state === 'cancelled') && (
              <>
                <h1 className="bk-heading">This session can’t be rated any more</h1>
                <p className="bk-lede">
                  {data.state === 'cancelled'
                    ? 'It was cancelled.'
                    : 'Ratings stay open for 60 days after a session.'}
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </ClientShell>
  );
}
