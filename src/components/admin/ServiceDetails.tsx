'use client';

import { useState } from 'react';
import { formatMoney, parseMoney, parseOptionalMoney, priceRefusal, toMoneyInput } from '@/lib/money';
import { LOCATION_OPTIONS, describeLocation } from '@/lib/service-location';
import { amountDue, paymentSettingProblem, type PaymentMode } from '@/lib/payments';
import type { SerializedEventType } from '@/lib/admin-serializers';
import type { BookingMode, ServiceLocationKind } from '@/lib/db/types';
import { SettingForm, SettingsPanel, type Setting } from './SettingsPanel';

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
  packBroken,
  onSave,
}: {
  slug: string;
  service: SerializedEventType;
  currency: string;
  takesPayments: boolean;
  /** "Monday to Friday, 9:00–17:00", or null with no hours at all. */
  hours: string | null;
  /** A pack with no size: the one service setting that stops booking. */
  packBroken: boolean;
  onSave: Saver;
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
      editor: <PaymentEditor slug={slug} service={s} currency={currency} takesPayments={takesPayments} onSave={onSave} />,
    },
    {
      id: 'when',
      label: 'When',
      value: hours ?? 'No opening hours',
      needed: hours === null,
      empty: hours === null,
      editor: <WhenEditor slug={slug} hours={hours} />,
    },
  ];

  return <SettingsPanel label={`${s.name}: settings`} settings={settings} />;
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
  onSave,
}: {
  slug: string;
  service: SerializedEventType;
  currency: string;
  takesPayments: boolean;
  onSave: Saver;
}) {
  const [mode, setMode] = useState<PaymentMode>(service.paymentMode);
  const savedDeposit = toMoneyInput(service.depositMinor, currency);
  const [deposit, setDeposit] = useState(savedDeposit);

  if (!takesPayments) {
    return (
      <p className="sp-purpose">
        Clients book without paying online. To have them pay when they book,{' '}
        <a href={`/admin/${slug}/account#payments`}>connect Stripe on your Account page</a>.
      </p>
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

function WhenEditor({ slug, hours }: { slug: string; hours: string | null }) {
  return (
    <div className="sp-form">
      <p className="sp-purpose">
        {hours
          ? `Within your opening hours, which every service shares: ${hours}.`
          : 'You have no opening hours yet, so nothing can be booked.'}
      </p>
      <div className="sp-keys">
        <a className={`btn-secondary${hours ? '' : ' is-need'}`} href={`/admin/${slug}/account#opening-hours`}>
          {hours ? 'Change opening hours' : 'Set opening hours'}
        </a>
        <a className="btn-link" href={`/admin/${slug}/week`}>
          Close a day, or time off
        </a>
      </div>
    </div>
  );
}
