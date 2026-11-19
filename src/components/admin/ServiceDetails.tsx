'use client';

import { useEffect, useState } from 'react';
import { Lamp } from '@/components/admin/Instruments';
import { formatMoney, parseMoney, parseOptionalMoney, priceRefusal, toMoneyInput } from '@/lib/money';
import { LOCATION_OPTIONS, describeLocation } from '@/lib/service-location';
import { amountDue, paymentSettingProblem, type PaymentMode } from '@/lib/payments';
import type { SerializedEventType } from '@/lib/admin-serializers';
import type { BookingMode, ServiceLocationKind } from '@/lib/db/types';
import { SettingForm, SettingsPanel, type Setting } from './SettingsPanel';
import { serviceHoursSummary, type ServiceHour } from '@/lib/service-hours';
import { limitToServiceHours } from '@/lib/availability';
import { GettingPaidCard, type PaymentsInfo } from './BillingCards';

type Saver = (body: Record<string, unknown>) => Promise<void>;

const PACK_PRESETS = [5, 8, 10];

export function lengthText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

/**
 * A service's Details tab: its settings, one line each, the chosen one
 * edited beside them. Each saves only itself, so changing the price can
 * never quietly change anything else.
 */
export function ServiceDetails({
  slug,
  service,
  currency,
  takesPayments,
  hours,
  openingRules,
  packBroken,
  onSave,
  account,
  onAccountChanged,
  open,
}: {
  slug: string;
  service: SerializedEventType;
  currency: string;
  takesPayments: boolean;
  /** "Monday to Friday, 9:00–17:00", or null with no hours at all. */
  hours: string | null;
  /** The opening hours themselves, to check this service's times fit them. */
  openingRules: ReadonlyArray<{ weekday: number; startTime: string; endTime: string }>;
  /** A pack with no size: the one service setting that stops booking. */
  packBroken: boolean;
  onSave: Saver;
  /** What the shared editors here need: the time zone and Stripe's state. */
  account: { timezone: string; payments: PaymentsInfo } | null;
  /** Opening hours or Stripe changed: everything shared is read again. */
  onAccountChanged: () => Promise<void>;
  /** Which line opens first, e.g. "when" from "set your opening hours". */
  open?: string;
}) {
  const s = service;
  const price =
    s.priceMinor === null ? 'Not shown' : s.priceMinor === 0 ? 'Free' : formatMoney(s.priceMinor, currency);
  const payment = !takesPayments
    ? 'Not online'
    : s.paymentMode === 'full'
      ? 'Paid in full'
      : s.paymentMode === 'deposit' && s.depositMinor
        ? `Deposit ${formatMoney(s.depositMinor, currency)}`
        : 'Not online';

  const settings: Setting[] = [
    { id: 'name', label: 'Name', value: s.name, editor: <NameEditor service={s} onSave={onSave} /> },
    {
      id: 'description',
      label: 'Description',
      value: s.description?.trim() || 'None yet',
      empty: !s.description?.trim(),
      editor: <DescriptionEditor service={s} onSave={onSave} />,
    },
    { id: 'length', label: 'Length', value: lengthText(s.durationMinutes), editor: <LengthEditor service={s} onSave={onSave} /> },
    {
      id: 'price',
      label: 'Price',
      value: price,
      empty: s.priceMinor === null,
      editor: <PriceEditor service={s} currency={currency} takesPayments={takesPayments} onSave={onSave} />,
    },
    {
      id: 'place',
      label: 'Place',
      value: describeLocation(s.locationKind, s.locationDetail) ?? 'Not set',
      empty: !s.locationKind,
      editor: <PlaceEditor service={s} onSave={onSave} />,
    },
    {
      id: 'booked',
      label: 'Booked as',
      value: s.bookingMode === 'pack' ? (s.packSize ? `Pack of ${s.packSize}` : 'Pack, size not set') : 'One at a time',
      needed: packBroken,
      editor: <BookedAsEditor service={s} onSave={onSave} />,
    },
    {
      id: 'payment',
      label: 'Payment',
      value: payment,
      empty: payment === 'Not online',
      editor: (
        <PaymentEditor
          slug={slug}
          service={s}
          currency={currency}
          takesPayments={takesPayments}
          payments={account?.payments ?? null}
          onPaymentsChanged={onAccountChanged}
          onSave={onSave}
        />
      ),
    },
    {
      id: 'when',
      label: 'When',
      value: hours ? serviceHoursSummary(s.bookableHours) : 'No opening hours',
      needed: hours === null,
      empty: hours === null,
      editor: <WhenEditor key={JSON.stringify(s.bookableHours)} slug={slug} service={s} hours={hours} openingRules={openingRules} onSave={onSave} />,
    },
  ];

  return <SettingsPanel key={open ?? ''} label={`${s.name}: settings`} settings={settings} initial={open} />;
}

/* ── The editors, one setting each ────────────────────────────────────── */

function NameEditor({ service, onSave }: { service: SerializedEventType; onSave: Saver }) {
  const [name, setName] = useState(service.name);
  return (
    <SettingForm
      purpose="What people see on your booking page."
      dirty={name.trim() !== '' && name.trim() !== service.name}
      save={() => onSave({ name: name.trim() })}
    >
      <input aria-label="Name" type="text" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
    </SettingForm>
  );
}

function DescriptionEditor({ service, onSave }: { service: SerializedEventType; onSave: Saver }) {
  const [text, setText] = useState(service.description ?? '');
  return (
    <SettingForm
      purpose="What someone reads under the name when choosing between your services."
      dirty={text.trim() !== (service.description ?? '').trim()}
      save={() => onSave({ description: text.trim() || null })}
    >
      <textarea aria-label="Description" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
    </SettingForm>
  );
}

function LengthEditor({ service, onSave }: { service: SerializedEventType; onSave: Saver }) {
  const [minutes, setMinutes] = useState(String(service.durationMinutes));
  const n = Number(minutes);
  const valid = Number.isInteger(n) && n >= 5 && n <= 1440;
  return (
    <SettingForm
      purpose="How long one session lasts. Your calendar keeps this much time free."
      dirty={valid && n !== service.durationMinutes}
      save={() => onSave({ durationMinutes: n })}
    >
      <div className="sp-inline">
        <input
          aria-label="Length in minutes"
          type="number"
          min={5}
          max={1440}
          step={5}
          className="sp-short"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
        <span>minutes</span>
      </div>
      {!valid && minutes !== '' && <p className="field-error">Between 5 and 1440 minutes.</p>}
    </SettingForm>
  );
}

function PriceEditor({
  service,
  currency,
  takesPayments,
  onSave,
}: {
  service: SerializedEventType;
  currency: string;
  takesPayments: boolean;
  onSave: Saver;
}) {
  const saved = toMoneyInput(service.priceMinor, currency);
  const [price, setPrice] = useState(saved);
  return (
    <SettingForm
      purpose="Shown beside the service on your booking page. Leave it empty to show no price; 0 shows Free."
      dirty={price.trim() !== saved}
      save={async () => {
        const parsed = parseOptionalMoney(price, currency);
        if (!parsed.ok) throw new Error(priceRefusal(price, currency));
        if (takesPayments && service.paymentMode !== 'none' && (parsed.minor === null || parsed.minor <= 0)) {
          throw new Error('Clients pay for this online. Turn that off under Payment first.');
        }
        await onSave({ priceMinor: parsed.minor });
      }}
    >
      <div className="sp-inline">
        <input
          aria-label={`Price in ${currency}`}
          type="text"
          inputMode="decimal"
          className="sp-short"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <span>{currency}</span>
      </div>
    </SettingForm>
  );
}

function PlaceEditor({ service, onSave }: { service: SerializedEventType; onSave: Saver }) {
  const [kind, setKind] = useState<ServiceLocationKind | ''>(service.locationKind ?? '');
  const [detail, setDetail] = useState(service.locationDetail ?? '');
  const dirty = kind !== (service.locationKind ?? '') || (kind === 'in_person' && detail.trim() !== (service.locationDetail ?? ''));
  return (
    <SettingForm
      purpose="Said in the confirmation and the calendar invite."
      dirty={dirty}
      save={() =>
        onSave({
          locationKind: kind === '' ? null : kind,
          locationDetail: kind === 'in_person' ? detail.trim() || null : null,
        })
      }
    >
      <select aria-label="Where it happens" value={kind} onChange={(e) => setKind(e.target.value as ServiceLocationKind | '')}>
        <option value="">Not set</option>
        {LOCATION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {kind === 'in_person' && (
        <div className="field">
          <label htmlFor="sp-address">Address</label>
          <input id="sp-address" type="text" value={detail} onChange={(e) => setDetail(e.target.value)} />
        </div>
      )}
    </SettingForm>
  );
}

function BookedAsEditor({ service, onSave }: { service: SerializedEventType; onSave: Saver }) {
  const [mode, setMode] = useState<BookingMode>(service.bookingMode);
  const [size, setSize] = useState(String(service.packSize ?? 10));
  const n = Number(size);
  const sizeOk = Number.isInteger(n) && n >= 2 && n <= 10;
  const dirty =
    mode !== service.bookingMode || (mode === 'pack' && sizeOk && n !== (service.packSize ?? 0));
  return (
    <SettingForm
      purpose={
        mode === 'pack'
          ? `Someone booking it picks all ${sizeOk ? n : 'the'} times at once and is saved as a client with that balance.`
          : 'Each booking is one session.'
      }
      dirty={dirty && (mode === 'single' || sizeOk)}
      save={() => onSave({ bookingMode: mode, packSize: mode === 'pack' ? n : null })}
    >
      <div className="wk-mode" role="group" aria-label="How it is booked">
        {(
          [
            ['single', 'One at a time'],
            ['pack', 'A pack'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" className="filter-chip" aria-pressed={mode === value} onClick={() => setMode(value)}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'pack' && (
        <div className="sp-inline">
          <span>Sessions in the pack</span>
          {PACK_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className="filter-chip"
              aria-pressed={n === p}
              onClick={() => setSize(String(p))}
            >
              {p}
            </button>
          ))}
          <input
            aria-label="Another number of sessions"
            type="text"
            inputMode="numeric"
            placeholder="2–10"
            className="sp-tiny"
            value={PACK_PRESETS.includes(n) ? '' : size}
            onChange={(e) => setSize(e.target.value)}
          />
        </div>
      )}
    </SettingForm>
  );
}

function PaymentEditor({
  slug,
  service,
  currency,
  takesPayments,
  payments,
  onPaymentsChanged,
  onSave,
}: {
  slug: string;
  service: SerializedEventType;
  currency: string;
  takesPayments: boolean;
  payments: PaymentsInfo | null;
  onPaymentsChanged: () => Promise<void>;
  onSave: Saver;
}) {
  const [mode, setMode] = useState<PaymentMode>(service.paymentMode);
  const savedDeposit = toMoneyInput(service.depositMinor, currency);
  const [deposit, setDeposit] = useState(savedDeposit);
  /* Just back from Stripe's onboarding (?stripe=back): say it worked, once,
     and drop the marker so a reload does not say it again. */
  const [justConnected, setJustConnected] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('stripe') !== 'back') return;
    setJustConnected(true);
    url.searchParams.delete('stripe');
    window.history.replaceState(null, '', url.toString());
  }, []);

  /* Not taking payments yet: connect Stripe right here, and come back here. */
  if (!takesPayments) {
    return (
      <div className="sp-form">
        <p className="sp-purpose">Clients book without paying online. To have them pay when they book, connect Stripe.</p>
        {payments ? (
          <GettingPaidCard
            slug={slug}
            payments={payments}
            onChanged={onPaymentsChanged}
            returnTo={`sessions/${service.id}?tab=details`}
          />
        ) : (
          <p className="status">Loading…</p>
        )}
      </div>
    );
  }

  const noPrice = service.priceMinor === null || service.priceMinor <= 0;
  const depositMinor = deposit.trim() ? parseMoney(deposit, currency) : null;
  const payable = {
    priceMinor: service.priceMinor,
    paymentMode: mode,
    depositMinor,
    bookingMode: service.bookingMode,
    packSize: service.packSize,
  };
  const due = amountDue(payable);
  const dirty = mode !== service.paymentMode || (mode === 'deposit' && deposit.trim() !== savedDeposit);

  return (
    <SettingForm
      purpose="Clients pay on Stripe’s secure page before the time is theirs. The money goes to your Stripe account."
      dirty={dirty}
      save={async () => {
        if (mode === 'deposit' && deposit.trim() && depositMinor === null) throw new Error(priceRefusal(deposit, currency));
        const problem = paymentSettingProblem(payable);
        if (problem) throw new Error(problem);
        await onSave({ paymentMode: mode, depositMinor: mode === 'deposit' ? depositMinor : null });
      }}
    >
      <p className="acct-line bp-readout" role={justConnected ? 'status' : undefined} style={{ margin: 0 }}>
        <Lamp tone="live" />
        {justConnected ? 'Stripe is connected. Now choose how clients pay for this service, and save.' : 'Stripe connected.'}{' '}
        <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer">
          Open Stripe
        </a>
      </p>
      <div className="wk-mode" role="group" aria-label="Paid when booking">
        {(
          [
            ['none', 'Not online'],
            ['full', 'In full'],
            ['deposit', 'Deposit'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="filter-chip"
            aria-pressed={mode === value}
            disabled={value !== 'none' && noPrice}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'deposit' && (
        <div className="sp-inline">
          <input
            aria-label={`Deposit in ${currency}`}
            type="text"
            inputMode="decimal"
            className="sp-short"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
          />
          <span>{currency}</span>
        </div>
      )}
      <p className="field-note">
        {noPrice
          ? 'Set a price first: there is nothing to charge.'
          : due
            ? due.kind === 'full'
              ? `Clients pay ${formatMoney(due.amountMinor, currency)} when they book${due.sessions > 1 ? `, all ${due.sessions} sessions` : ''}. Cancelled before your minimum notice: refunded automatically.`
              : `Clients pay ${formatMoney(due.amountMinor, currency)} when they book, and the other ${formatMoney(due.totalMinor - due.amountMinor, currency)} to you directly.`
            : mode === 'none'
              ? 'Clients book without paying online. Settle it however you do today.'
              : ''}
      </p>
    </SettingForm>
  );
}

const WEEKDAYS = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
] as const;

/**
 * When this service can be booked: whenever the business is open, or only
 * some days and times inside the opening hours. The opening hours
 * themselves are the business's, set on Account, and nothing here changes
 * them: a service can narrow them, never widen them.
 */
function WhenEditor({
  slug,
  service,
  hours,
  openingRules,
  onSave,
}: {
  slug: string;
  service: SerializedEventType;
  hours: string | null;
  openingRules: ReadonlyArray<{ weekday: number; startTime: string; endTime: string }>;
  onSave: Saver;
}) {
  const saved: ServiceHour[] | null = service.bookableHours;
  const [limited, setLimited] = useState(!!saved && saved.length > 0);
  const [days, setDays] = useState<number[]>(saved?.length ? [...new Set(saved.map((h) => h.weekday))] : [1, 2, 3, 4, 5]);
  const [from, setFrom] = useState(saved?.[0]?.startTime ?? '09:00');
  const [to, setTo] = useState(saved?.[0]?.endTime ?? '17:00');

  const next: ServiceHour[] | null = limited
    ? [...days].sort().map((weekday) => ({ weekday, startTime: from, endTime: to }))
    : null;
  const dirty = JSON.stringify(next) !== JSON.stringify(saved && saved.length ? saved : null);
  // Minutes a week this service could actually be booked, inside the opening hours.
  const weekly = [1, 2, 3, 4, 5, 6, 7].reduce((sum, d) => {
    const open = openingRules.filter((r) => r.weekday === d);
    return (
      sum +
      limitToServiceHours(open, d, next).reduce((m, w) => {
        const [sh, sm] = w.startTime.split(':').map(Number);
        const [eh, em] = w.endTime.split(':').map(Number);
        return m + (eh! * 60 + em!) - (sh! * 60 + sm!);
      }, 0)
    );
  }, 0);

  if (!hours) {
    return (
      <div className="sp-form">
        <p className="sp-purpose">
          You have no opening hours yet, so no service can be booked. They are your business&apos;s, set once for every
          service.
        </p>
        <a className="btn-secondary is-need" href={`/admin/${slug}/account#opening-hours`}>
          Set your opening hours
        </a>
      </div>
    );
  }

  return (
    <SettingForm
      purpose={`Inside your opening hours (${hours}). Choose some days or times if this service is only for them; your opening hours stay as they are.`}
      dirty={dirty && (!limited || (days.length > 0 && from < to))}
      save={() => onSave({ bookableHours: next })}
    >
      <div className="wk-mode" role="group" aria-label="When it can be booked">
        <button type="button" className="filter-chip" aria-pressed={!limited} onClick={() => setLimited(false)}>
          Whenever you&apos;re open
        </button>
        <button type="button" className="filter-chip" aria-pressed={limited} onClick={() => setLimited(true)}>
          Only some days and times
        </button>
      </div>
      {limited && (
        <>
          <div className="sh-days" role="group" aria-label="Days">
            {WEEKDAYS.map(([d, label]) => (
              <button
                key={d}
                type="button"
                className="filter-chip"
                aria-pressed={days.includes(d)}
                onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="sh-times">
            <input aria-label="From" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>to</span>
            <input aria-label="To" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <p className={`field-note${weekly === 0 ? ' field-error' : ''}`}>
            {days.length === 0
              ? 'Choose at least one day.'
              : from >= to
                ? 'The end time must be after the start time.'
                : weekly === 0
                  ? 'None of these times are inside your opening hours, so nobody could book it.'
                  : `Bookable about ${Math.round((weekly / 60) * 10) / 10} h a week, where these times meet your opening hours.`}
          </p>
        </>
      )}
      <p className="field-note">
        <a href={`/admin/${slug}/account#opening-hours`}>Your opening hours</a> are for the whole business, in Your business.
      </p>
    </SettingForm>
  );
}
