'use client';

import { useEffect, useState } from 'react';
import { formatMoney } from '@/lib/money';
import { ClientShell, type ShellBusiness } from './ClientShell';

type Result =
  | { status: 'pending' | 'expired'; business: ShellBusiness; backLink: string }
  | {
      status: 'failed';
      business: ShellBusiness;
      backLink: string;
      message: string;
      amountMinor: number;
      currency: string;
    }
  | {
      status: 'paid';
      business: ShellBusiness;
      backLink: string;
      payment: {
        kind: 'full' | 'deposit';
        amountMinor: number;
        currency: string;
        refundedMinor: number;
      };
      service: { name: string; durationMinutes: number | null };
      email: string;
      bookings: Array<{
        startsAt: string;
        endsAt: string;
        status: string;
        manageToken: string;
        meetingUrl: string | null;
      }>;
      programmeLink: string | null;
    };

/** How long to keep asking while Stripe finishes: 2 seconds, 20 times. */
const POLL_MS = 2000;
const POLL_TIMES = 20;

/**
 * Back from Stripe. Asks the server to finish the payment, then says one of
 * four things: booked; still being confirmed; the time went while they paid
 * and the money is on its way back; or the payment page ran out.
 */
export default function PaidReturn({ slug, sessionId }: { slug: string; sessionId: string | null }) {
  const [result, setResult] = useState<Result | null>(null);
  const [missing, setMissing] = useState(!sessionId);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/t/${encodeURIComponent(slug)}/payments/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        if (response.status === 404) {
          if (!cancelled) setMissing(true);
          return;
        }
        if (!response.ok) throw new Error();
        const body = (await response.json()) as Result;
        if (cancelled) return;
        setResult(body);
        if (body.status === 'pending' && tries < POLL_TIMES) {
          setTimeout(() => !cancelled && setTries((n) => n + 1), POLL_MS);
        }
      } catch {
        // A hiccup on our side is not an answer: ask again, a few times.
        if (!cancelled && tries < POLL_TIMES) setTimeout(() => setTries((n) => n + 1), POLL_MS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, sessionId, tries]);

  const day = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ');

  return (
    <ClientShell business={result?.business ?? null}>
      <div className="bk-solo">
        <div className="bk-panel">
          <section className="bk-steps">
            {missing && (
              <>
                <h1 className="bk-heading">We can’t find this payment</h1>
                <p className="bk-lede">
                  If you paid, your confirmation email has everything. Otherwise,{' '}
                  <a className="bk-textlink" href={`/t/${encodeURIComponent(slug)}`}>
                    start again from the booking page
                  </a>
                  .
                </p>
              </>
            )}

            {!missing && (!result || (result.status === 'pending' && tries < POLL_TIMES)) && (
              <>
                <h1 className="bk-heading">Confirming your payment…</h1>
                <p className="bk-lede" role="status">
                  This takes a few seconds. Please keep this page open.
                </p>
              </>
            )}

            {result?.status === 'pending' && tries >= POLL_TIMES && (
              <>
                <h1 className="bk-heading">Your payment is still going through</h1>
                <p className="bk-lede">
                  Some payments take a little longer. As soon as it does, your time is booked and a
                  confirmation is emailed to you — there is nothing more to do here.
                </p>
              </>
            )}

            {result?.status === 'expired' && (
              <>
                <h1 className="bk-heading">The payment page ran out</h1>
                <p className="bk-lede">Nothing was charged and nothing is booked.</p>
                <a className="btn-primary btn-full" href={result.backLink}>
                  Choose a time again
                </a>
              </>
            )}

            {result?.status === 'failed' && (
              <>
                <h1 className="bk-heading">That time went while you were paying</h1>
                <p className="bk-lede">
                  Somebody booked it moments before your payment went through, so nothing is booked and your{' '}
                  {formatMoney(result.amountMinor, result.currency)} is being refunded to you. Refunds usually
                  show within 5–10 days.
                </p>
                <a className="btn-primary btn-full" href={result.backLink}>
                  Choose another time
                </a>
              </>
            )}

            {result?.status === 'paid' && (
              <>
                <h1 className="bk-heading">You’re booked</h1>
                <p className="bk-lede">
                  {result.bookings.length > 1
                    ? `All ${result.bookings.length} sessions of ${result.service.name}`
                    : result.service.name}{' '}
                  with {result.business.name}. A confirmation is on its way to {result.email}.
                </p>

                <dl className="bk-review">
                  <div className="bk-review-row">
                    <dt>{result.bookings.length > 1 ? 'Appointments' : 'When'}</dt>
                    <dd>
                      <ol
                        className="bk-review-dates"
                        style={result.bookings.length > 1 ? undefined : { listStyle: 'none', padding: 0 }}
                      >
                        {result.bookings.map((b) => (
                          <li key={b.manageToken}>
                            {day.format(new Date(b.startsAt))}, {time.format(new Date(b.startsAt))} –{' '}
                            {time.format(new Date(b.endsAt))}{' '}
                            <a className="bk-textlink" href={`/manage/${b.manageToken}`}>
                              Manage
                            </a>
                          </li>
                        ))}
                      </ol>
                      <span className="bk-review-sub">{zone}</span>
                    </dd>
                  </div>
                  <div className="bk-review-row">
                    <dt>Paid</dt>
                    <dd>
                      {formatMoney(result.payment.amountMinor, result.payment.currency)}
                      <span className="bk-review-sub">
                        {result.payment.kind === 'deposit'
                          ? 'Deposit · the rest is paid directly'
                          : 'In full'}{' '}
                        · receipt from Stripe by email
                      </span>
                    </dd>
                  </div>
                  {result.bookings[0]?.meetingUrl && (
                    <div className="bk-review-row">
                      <dt>Video link</dt>
                      <dd>
                        <a
                          className="bk-map-link"
                          href={result.bookings[0].meetingUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Join the call
                        </a>
                        <span className="bk-review-sub">Also in your confirmation email.</span>
                      </dd>
                    </div>
                  )}
                </dl>

                {result.programmeLink && (
                  <p className="bk-after">
                    Your programme is kept on{' '}
                    <a className="bk-textlink" href={result.programmeLink}>
                      your own link
                    </a>{' '}
                    — move a session or see what is left there.
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </ClientShell>
  );
}
