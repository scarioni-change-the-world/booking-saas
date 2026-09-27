'use client';

import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { adminFetchJson } from '@/lib/admin-fetch';
import { Lamp } from '@/components/admin/Instruments';
import type { BillingState } from '@/lib/subscription';

export interface PlanInfo {
  plan: 'trial' | 'starter' | 'pro' | 'cancelled';
  trialEndsAt: string | null;
  freeAccess: boolean;
  state: BillingState;
  renewsAt: string | null;
  hasCustomer: boolean;
  canSubscribe: boolean;
}

export interface PaymentsInfo {
  available: boolean;
  connected: boolean;
  chargesEnabled: boolean;
}

const day = (iso: string) => DateTime.fromISO(iso).toFormat('d LLLL');

async function go(url: string, setError: (e: string) => void, setBusy: (b: boolean) => void) {
  setBusy(true);
  try {
    const { url: next } = await adminFetchJson<{ url: string }>(url, {
      method: 'POST',
    });
    window.location.href = next;
  } catch (cause) {
    setError((cause as Error).message);
    setBusy(false);
  }
}

/**
 * Paying intro. The card says where the business stands and offers the one
 * thing to do next: subscribe, manage billing on Stripe's own page, or fix
 * a card that failed — the only Ochre here, because it needs them.
 */
export function PlanCard({ slug, plan }: { slug: string; plan: PlanInfo }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justPaid, setJustPaid] = useState(false);
  useEffect(() => {
    setJustPaid(new URLSearchParams(window.location.search).get('billing') === 'done');
  }, []);

  const subscribe = () => void go(`/api/admin/${slug}/billing/checkout`, setError, setBusy);
  const manage = () => void go(`/api/admin/${slug}/billing/portal`, setError, setBusy);
  const trialLeft = plan.trialEndsAt ? DateTime.fromISO(plan.trialEndsAt).diffNow('days').days : 0;

  return (
    <section className="card acct-card">
      <div className="admin-card-title">Your plan</div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {justPaid && plan.state !== 'active' && (
        <p className="notice notice-muted" role="status">
          Thank you — your subscription is being set up. This can take a few seconds to show here.
        </p>
      )}

      {plan.state === 'free' && <p className="acct-line">Free access. Nothing to pay.</p>}

      {plan.state === 'trial' && (
        <>
          <p className="acct-line">
            {plan.trialEndsAt && trialLeft > 0
              ? `On a free trial until ${day(plan.trialEndsAt)}.`
              : 'Your trial has ended.'}
          </p>
          {plan.canSubscribe ? (
            <>
              <div className="wk-actions" style={{ marginTop: 0 }}>
                <button type="button" className="btn-primary" disabled={busy} onClick={subscribe}>
                  {busy ? 'Opening Stripe…' : 'Subscribe — €7 a month'}
                </button>
              </div>
              <p className="field-note">
                {trialLeft > 2
                  ? 'You won’t be charged until your trial ends. Cancel any time.'
                  : 'Billing starts today. Cancel any time.'}
              </p>
            </>
          ) : (
            <p className="field-note">
              Paying online isn’t switched on yet — we’ll be in touch before your trial ends.
            </p>
          )}
        </>
      )}

      {plan.state === 'active' && (
        <>
          <p className="acct-line">
            €7 a month
            {plan.renewsAt ? ` · renews on ${day(plan.renewsAt)}` : ''}.
          </p>
          {plan.hasCustomer && (
            <div className="wk-actions" style={{ marginTop: 0 }}>
              <button type="button" className="btn-secondary" disabled={busy} onClick={manage}>
                {busy ? 'Opening Stripe…' : 'Manage billing'}
              </button>
              <span className="field-note">Change your card, download invoices or cancel, on Stripe.</span>
            </div>
          )}
        </>
      )}

      {plan.state === 'past_due' && (
        <>
          <p className="acct-line bp-readout is-need" style={{ margin: 0 }}>
            <Lamp tone="need" />
            Your last payment didn’t go through. Stripe will try again — update your card to keep your booking
            page open.
          </p>
          <div className="wk-actions">
            <button type="button" className="btn-secondary is-need" disabled={busy} onClick={manage}>
              {busy ? 'Opening Stripe…' : 'Update your card'}
            </button>
          </div>
        </>
      )}

      {plan.state === 'cancelled' && (
        <>
          <p className="acct-line">Your subscription has ended.</p>
          {plan.canSubscribe && (
            <div className="wk-actions" style={{ marginTop: 0 }}>
              <button type="button" className="btn-primary" disabled={busy} onClick={subscribe}>
                {busy ? 'Opening Stripe…' : 'Subscribe — €7 a month'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Being paid by clients: the business's own Stripe account. The money goes
 * straight to them; intro takes no cut.
 */
export function GettingPaidCard({
  slug,
  payments,
  onChanged,
}: {
  slug: string;
  payments: PaymentsInfo;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Back from Stripe's onboarding: ask where the account stands now,
     rather than waiting for the webhook. */
  useEffect(() => {
    const back = new URLSearchParams(window.location.search).get('stripe');
    if (!back || !payments.connected) return;
    adminFetchJson(`/api/admin/${slug}/payments/status`, { method: 'POST' })
      .then(() => onChanged())
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  const connect = () => void go(`/api/admin/${slug}/payments/connect`, setError, setBusy);

  return (
    <section className="card acct-card">
      <div className="admin-card-title">Getting paid</div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {!payments.available ? (
        <p className="acct-line">Taking payments from clients isn’t switched on yet.</p>
      ) : payments.chargesEnabled ? (
        <>
          <p className="acct-line bp-readout" style={{ margin: 0 }}>
            <Lamp tone="live" />
            Clients can pay you through your Stripe account.
          </p>
          <p className="field-note">
            Choose how each service is paid in its settings — in full, a deposit, or not online. Payments,
            refunds and payouts are in your own Stripe, and intro takes no cut.{' '}
            <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer">
              Open Stripe
            </a>
          </p>
        </>
      ) : payments.connected ? (
        <>
          <p className="acct-line bp-readout is-need" style={{ margin: 0 }}>
            <Lamp tone="need" />
            Stripe needs a few more details before clients can pay you.
          </p>
          <div className="wk-actions">
            <button type="button" className="btn-secondary is-need" disabled={busy} onClick={connect}>
              {busy ? 'Opening Stripe…' : 'Finish on Stripe'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="acct-line">
            Let clients pay when they book — for a session, a deposit or a whole programme. The money goes
            straight to your own Stripe account; intro takes no cut, and you pay only Stripe’s fee.
          </p>
          <div className="wk-actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn-primary" disabled={busy} onClick={connect}>
              {busy ? 'Opening Stripe…' : 'Connect Stripe'}
            </button>
          </div>
          <p className="field-note">
            Already have a Stripe account? You can use it. If not, Stripe sets one up in a few minutes.
          </p>
        </>
      )}
    </section>
  );
}
