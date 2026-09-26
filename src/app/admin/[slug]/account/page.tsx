'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import { BookingPageCard, type Branding } from '@/components/admin/BookingPageCard';

interface Account {
  business: { name: string; slug: string; timezone: string; createdAt: string };
  branding: Branding;
  currency: string;
  plan: { plan: 'trial' | 'starter' | 'pro' | 'cancelled'; trialEndsAt: string | null; freeAccess: boolean };
  me: { email: string | null; role: 'owner' | 'admin' | 'member' };
  team: Array<{ email: string | null; role: 'owner' | 'admin' | 'member'; you: boolean }>;
}

/**
 * The currencies offered in the picker — a short list rather than all of
 * ISO 4217, because this product's customers are coaches, therapists and
 * consultants. The column accepts any three letters, so a missing one is a
 * one-line addition, not a migration.
 */
const CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CAD', 'AUD', 'NZD', 'JPY', 'BRL', 'MXN'];

function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const ROLE: Record<Account['me']['role'], string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

/**
 * Account: what is left of Settings.
 *
 * Settings used to hold everything nobody knew where else to put. Most of
 * it now lives where it takes effect — notice, booking window and Google
 * Calendar on the Week; the page's embed code on Flow; email addresses on
 * Messages — and this keeps what is truly about the account: the business's
 * name and time zone, how its booking page looks, what it charges in, who is
 * signed in, the team and the plan. Things set once and rarely touched.
 */
export default function AccountPage() {
  const { slug } = useParams<{ slug: string }>();
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccount(await adminFetchJson<Account>(`/api/admin/${slug}/account`));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const a = (path: string) => `/admin/${slug}/${path}`;

  return (
    <>
      <PageHeader
        title={account?.business.name ?? 'Account'}
        description="Things set once and rarely touched. Everything else lives where it takes effect."
      />

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {!account && !error && <p className="status">Loading…</p>}

      {account && (
        <div className="acct">
          <div className="acct-main">
            <BusinessCard slug={slug} account={account} onSaved={load} />
            <BookingPageCard
              slug={slug}
              businessName={account.business.name}
              saved={account.branding}
              onSaved={load}
            />
            <CurrencyCard slug={slug} current={account.currency} onSaved={load} />

            <section className="card acct-card">
              <div className="admin-card-title">Signing in</div>
              <p className="acct-line">
                You sign in as <b>{account.me.email ?? 'this account'}</b> · {ROLE[account.me.role]}
              </p>
              <p className="acct-line">
                <a href="/admin/forgot-password">Change your password</a> — we email you a link to set a new one.
              </p>
            </section>

            <section className="card acct-card">
              <div className="admin-card-title">Your team</div>
              <ul className="acct-team">
                {account.team.map((m, i) => (
                  <li key={`${m.email}-${i}`}>
                    <span>
                      {m.email ?? 'Someone without an address'}
                      {m.you && <small> · you</small>}
                    </span>
                    <span className="wk-muted">{ROLE[m.role]}</span>
                  </li>
                ))}
              </ul>
              <p className="wk-side-hint">Adding or removing someone is done by support for now — just ask.</p>
            </section>

            <section className="card acct-card">
              <div className="admin-card-title">Your plan</div>
              <p className="acct-line">{planLine(account.plan)}</p>
            </section>
          </div>

          <aside className="acct-side">
            <p className="wk-side-eyebrow">Where everything else is</p>
            <ul className="acct-moved">
              <li>
                <a href={a('week')}>Week</a>
                <span>Your hours, minimum notice, how far ahead people can book, and Google Calendar.</span>
              </li>
              <li>
                <a href={a('flow?part=page')}>Services → your booking page</a>
                <span>Your booking link, and the code to put it on your own website.</span>
              </li>
              <li>
                <a href={a('messages')}>Messages</a>
                <span>What every email says, where booking alerts go, and where replies land.</span>
              </li>
              <li>
                <a href={a('flow')}>Services → a service’s settings</a>
                <span>Each service’s price, length, place and who it is offered to.</span>
              </li>
            </ul>
          </aside>
        </div>
      )}
    </>
  );
}

function planLine(plan: Account['plan']): string {
  if (plan.freeAccess) return 'Free access. Nothing to pay.';
  if (plan.plan === 'trial') {
    if (!plan.trialEndsAt) return 'On a trial.';
    const ends = DateTime.fromISO(plan.trialEndsAt);
    return ends < DateTime.now()
      ? `Your trial ended on ${ends.toFormat('d LLLL')}.`
      : `On a trial until ${ends.toFormat('d LLLL')}.`;
  }
  if (plan.plan === 'cancelled') return 'Cancelled.';
  return `On the ${plan.plan[0]!.toUpperCase()}${plan.plan.slice(1)} plan.`;
}

function BusinessCard({ slug, account, onSaved }: { slug: string; account: Account; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(account.business.name);
  const [zone, setZone] = useState(account.business.timezone);
  const [zones, setZones] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      setZones(Intl.supportedValuesOf('timeZone'));
    } catch {
      setZones([account.business.timezone]);
    }
  }, [account.business.timezone]);

  const zoneChanged = zone !== account.business.timezone;
  const dirty = name.trim() !== account.business.name || zoneChanged;

  /* The effect of a new zone, before it is saved: a 10:00 opening hour stays
     10:00 in the new place, and a booking made for 10:00 here is shown at
     whatever that same moment is there. */
  const preview = useMemo(() => {
    if (!zoneChanged) return null;
    const moment = DateTime.now().setZone(account.business.timezone).plus({ days: 7 }).set({ hour: 10, minute: 0 });
    return {
      booked: moment.setZone(zone).toFormat('HH:mm'),
      day: moment.toFormat('cccc'),
    };
  }, [zone, zoneChanged, account.business.timezone]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await adminFetchJson(`/api/admin/${slug}/account`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(name.trim() !== account.business.name ? { name: name.trim() } : {}),
          ...(zoneChanged ? { timezone: zone } : {}),
        }),
      });
      await onSaved();
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card acct-card" onSubmit={save}>
      <div className="admin-card-title">Your business</div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="field">
        <label htmlFor="acct-name">Name</label>
        <input id="acct-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        <p className="field-note">On your booking page and at the top of every email.</p>
      </div>
      <div className="field">
        <label htmlFor="acct-address">Web address</label>
        <input id="acct-address" type="text" value={`/t/${account.business.slug}`} readOnly />
        <p className="field-note">Fixed, so links you have already shared keep working.</p>
      </div>
      <div className="field">
        <label htmlFor="acct-zone">Time zone</label>
        <select id="acct-zone" value={zone} onChange={(e) => setZone(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        {preview ? (
          <p className="wk-warning" style={{ marginTop: 8 }}>
            Your opening hours keep their clock times, now in {zone.replace(/_/g, ' ')}: 09:00 stays 09:00. A booking
            already made for {preview.day} at 10:00 is the same moment, shown as {preview.booked}.
          </p>
        ) : (
          <p className="field-note">Every hour and booking time is read in this zone.</p>
        )}
      </div>
      <div className="wk-actions" style={{ marginTop: 0 }}>
        <button type="submit" className="btn-primary" disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && !dirty && <span className="ms-saved">Saved.</span>}
      </div>
    </form>
  );
}

function CurrencyCard({ slug, current, onSaved }: { slug: string; current: string; onSaved: () => Promise<void> }) {
  const [currency, setCurrency] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const options = CURRENCIES.includes(current) ? CURRENCIES : [current, ...CURRENCIES];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await adminFetchJson(`/api/admin/${slug}/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currency }),
      });
      await onSaved();
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card acct-card" onSubmit={save}>
      <div className="admin-card-title">Money</div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="acct-currency">Currency</label>
        <select id="acct-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {options.map((code) => (
            <option key={code} value={code}>
              {code} — {currencyName(code)}
            </option>
          ))}
        </select>
        {currency !== current ? (
          <p className="wk-warning" style={{ marginTop: 8 }}>
            Prices are relabelled, not converted: a service at 120 {current} will show as 120 {currency}. Check your
            services after.
          </p>
        ) : (
          <p className="field-note">Every price on a service is shown in this.</p>
        )}
      </div>
      <div className="wk-actions" style={{ marginTop: 0 }}>
        <button type="submit" className="btn-primary" disabled={currency === current || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && currency === current && <span className="ms-saved">Saved.</span>}
      </div>
    </form>
  );
}
