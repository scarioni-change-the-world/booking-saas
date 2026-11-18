'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import { BookingPageCard, type Branding } from '@/components/admin/BookingPageCard';
import { OpeningHoursCard } from '@/components/admin/OpeningHoursCard';
import { GettingPaidCard, PlanCard, type PaymentsInfo, type PlanInfo } from '@/components/admin/BillingCards';
import { SettingForm, SettingsPanel, type Setting } from '@/components/admin/SettingsPanel';
import { hoursSummary, type HoursRule } from '@/lib/setup';

interface Account {
  business: { name: string; slug: string; timezone: string; createdAt: string };
  branding: Branding;
  currency: string;
  plan: PlanInfo;
  payments: PaymentsInfo;
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
 * Account: what is left of Settings, one line per setting (SettingsPanel).
 * The chosen one is edited beside the list.
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
  const [hours, setHours] = useState<HoursRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccount(await adminFetchJson<Account>(`/api/admin/${slug}/account`));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [slug]);

  const loadHours = useCallback(async () => {
    try {
      setHours((await adminFetchJson<{ rules: HoursRule[] }>(`/api/admin/${slug}/availability-rules`)).rules);
    } catch {
      setHours(null);
    }
  }, [slug]);

  useEffect(() => {
    void load();
    void loadHours();
  }, [load, loadHours]);

  // A link to #opening-hours while already here opens that line.
  const [hashKey, setHashKey] = useState(0);
  useEffect(() => {
    const onHash = () => setHashKey((k) => k + 1);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);


  return (
    <>
      <PageHeader title={account?.business.name ?? 'Account'} />

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {!account && !error && <p className="status">Loading…</p>}

      {account && (
        <>
          <SettingsPanel key={hashKey} label="Your account" settings={accountSettings(slug, account, hours, load, loadHours)} initial={fromHash()} />

        </>
      )}
    </>
  );
}

/** Links elsewhere open the setting they name: account#opening-hours. */
function fromHash(): string | undefined {
  const hash = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  return (
    { 'opening-hours': 'hours', 'booking-page': 'look', payments: 'paid', plan: 'plan', currency: 'currency' } as Record<
      string,
      string
    >
  )[hash];
}

function accountSettings(
  slug: string,
  account: Account,
  hours: HoursRule[] | null,
  load: () => Promise<void>,
  loadHours: () => Promise<void>,
): Setting[] {
  const b = account.branding;
  const look =
    b.logoUrl && b.accentColor ? 'Logo and colour' : b.logoUrl ? 'Logo' : b.accentColor ? 'Colour' : 'khloe’s plain look';
  const p = account.payments;
  const paid = !p.available
    ? 'Not available yet'
    : p.connected && p.chargesEnabled
      ? 'Stripe connected'
      : p.connected
        ? 'Stripe: finish setting up'
        : 'Not connected';
  const plan = account.plan;
  const daysLeft = plan.trialEndsAt ? Math.max(0, Math.ceil(DateTime.fromISO(plan.trialEndsAt).diffNow('days').days)) : 0;
  const planText = {
    free: 'Free access',
    trial: daysLeft > 0 ? `Free trial, ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left` : 'Free trial ended',
    active: 'Active',
    past_due: 'Payment failed',
    cancelled: 'Cancelled',
  }[plan.state];

  return [
    {
      id: 'name',
      label: 'Business name',
      value: account.business.name,
      editor: <NameEditor slug={slug} current={account.business.name} onSaved={load} />,
    },
    {
      id: 'address',
      label: 'Web address',
      value: `khloe.io/${account.business.slug}`,
      editor: (
        <p className="sp-purpose">
          Your booking page is at <b>khloe.io/{account.business.slug}</b>. It is fixed, so links you have already
          shared keep working. <a href={`/admin/${slug}/share`}>Share it</a>.
        </p>
      ),
    },
    {
      id: 'zone',
      label: 'Time zone',
      value: account.business.timezone.replace(/_/g, ' '),
      editor: <ZoneEditor slug={slug} current={account.business.timezone} onSaved={load} />,
    },
    {
      id: 'hours',
      label: 'Opening hours',
      value: hours === null ? '…' : hours.length ? hoursSummary(hours) : 'None yet',
      empty: hours !== null && hours.length === 0,
      needed: hours !== null && hours.length === 0,
      editor: (
        <OpeningHoursCard
          slug={slug}
          timezone={account.business.timezone}
          weekHref={`/admin/${slug}/week`}
          onSaved={() => void loadHours()}
        />
      ),
    },
    {
      id: 'look',
      label: 'Booking page',
      value: look,
      empty: !b.logoUrl && !b.accentColor,
      editor: <BookingPageCard slug={slug} businessName={account.business.name} saved={b} onSaved={load} />,
    },
    {
      id: 'paid',
      label: 'Getting paid',
      value: paid,
      empty: !(p.connected && p.chargesEnabled),
      editor: <GettingPaidCard slug={slug} payments={p} onChanged={load} />,
    },
    {
      id: 'currency',
      label: 'Currency',
      value: `${account.currency} · ${currencyName(account.currency)}`,
      editor: <CurrencyCard slug={slug} current={account.currency} onSaved={load} />,
    },
    {
      id: 'signin',
      label: 'Signing in',
      value: account.me.email ?? 'This account',
      editor: (
        <div className="sp-form">
          <p className="sp-purpose">
            You sign in as <b>{account.me.email ?? 'this account'}</b> · {ROLE[account.me.role]}.
          </p>
          <a className="btn-secondary" href="/admin/forgot-password">
            Change your password
          </a>
          <p className="field-note">We email you a link to set a new one.</p>
        </div>
      ),
    },
    {
      id: 'team',
      label: 'Team',
      value: account.team.length === 1 ? 'Just you' : `${account.team.length} people`,
      editor: (
        <div className="sp-form">
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
          <p className="field-note">Adding or removing someone is done by support for now. Just ask.</p>
        </div>
      ),
    },
    {
      id: 'plan',
      label: 'Plan',
      value: planText,
      needed: plan.state === 'past_due' || plan.state === 'cancelled',
      editor: <PlanCard slug={slug} plan={plan} />,
    },
  ];
}

async function patchAccount(slug: string, body: Record<string, unknown>) {
  await adminFetchJson(`/api/admin/${slug}/account`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function NameEditor({ slug, current, onSaved }: { slug: string; current: string; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(current);
  return (
    <SettingForm
      purpose="On your booking page and at the top of every email."
      dirty={name.trim() !== '' && name.trim() !== current}
      save={async () => {
        await patchAccount(slug, { name: name.trim() });
        await onSaved();
      }}
    >
      <input aria-label="Business name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
    </SettingForm>
  );
}

function ZoneEditor({ slug, current, onSaved }: { slug: string; current: string; onSaved: () => Promise<void> }) {
  const [zone, setZone] = useState(current);
  const [zones, setZones] = useState<string[]>([current]);
  useEffect(() => {
    try {
      setZones(Intl.supportedValuesOf('timeZone'));
    } catch {
      /* Only the current one. */
    }
  }, []);

  /* The effect of a new zone, before it is saved: a 10:00 opening hour stays
     10:00 in the new place, and a booking made for 10:00 here is shown at
     whatever that same moment is there. */
  const preview = useMemo(() => {
    if (zone === current) return null;
    const moment = DateTime.now().setZone(current).plus({ days: 7 }).set({ hour: 10, minute: 0 });
    return { booked: moment.setZone(zone).toFormat('HH:mm'), day: moment.toFormat('cccc') };
  }, [zone, current]);

  return (
    <SettingForm
      purpose="Every hour and booking time is read in this zone."
      dirty={zone !== current}
      save={async () => {
        await patchAccount(slug, { timezone: zone });
        await onSaved();
      }}
    >
      <select aria-label="Time zone" value={zone} onChange={(e) => setZone(e.target.value)}>
        {zones.map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      {preview && (
        <p className="wk-warning" style={{ margin: 0 }}>
          Your opening hours keep their clock times, now in {zone.replace(/_/g, ' ')}: 09:00 stays 09:00. A booking
          already made for {preview.day} at 10:00 is the same moment, shown as {preview.booked}.
        </p>
      )}
    </SettingForm>
  );
}

function CurrencyCard({ slug, current, onSaved }: { slug: string; current: string; onSaved: () => Promise<void> }) {
  const [currency, setCurrency] = useState(current);
  const options = CURRENCIES.includes(current) ? CURRENCIES : [current, ...CURRENCIES];
  return (
    <SettingForm
      purpose="Every price on a service is shown in this."
      dirty={currency !== current}
      save={async () => {
        await adminFetchJson(`/api/admin/${slug}/settings`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ currency }),
        });
        await onSaved();
      }}
    >
      <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
        {options.map((code) => (
          <option key={code} value={code}>
            {code} — {currencyName(code)}
          </option>
        ))}
      </select>
      {currency !== current && (
        <p className="wk-warning" style={{ margin: 0 }}>
          Prices are relabelled, not converted: a service at 120 {current} will show as 120 {currency}. Check your
          services after.
        </p>
      )}
    </SettingForm>
  );
}
