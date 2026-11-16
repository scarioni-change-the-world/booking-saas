'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import {
  DEFAULT_CURRENCY,
  formatMoney,
  parseMoney,
  parseOptionalMoney,
  priceRefusal,
  toMoneyInput,
} from '@/lib/money';
import { LOCATION_OPTIONS } from '@/lib/service-location';
import { useServiceMark } from '@/components/admin/ServiceMarks';
import { ServiceBadge } from '@/components/admin/ServiceBadge';
import { DeleteService } from '@/components/admin/DeleteService';
import { ServiceQuestions } from '@/components/admin/ServiceQuestions';
import { AskKhloeBox } from '@/components/admin/AskKhloeBox';
import { setupStages, type ServiceFacts, type Stage, type StageId } from '@/lib/service-setup';
import type { SerializedEventType } from '@/lib/admin-serializers';
import type { BookingMode, ServiceLocationKind } from '@/lib/db/types';
import { amountDue, paymentSettingProblem, type PaymentMode } from '@/lib/payments';

interface SetupPayload {
  services: Array<SerializedEventType & { ownQuestionCount: number }>;
  globalQuestionCount: number;
  availabilityRuleCount: number;
  hasOtherPathMessage: boolean;
  hasOtherPathUrl: boolean;
  takesPayments?: boolean;
}

const PACK_PRESETS = [5, 8, 10];

type Tab = 'details' | 'questions' | 'messages' | 'who';

/**
 * A service: everything about it, in the order each decision informs the
 * next.
 *
 * THE ONLY PLACE A SERVICE IS EDITED. There was briefly a second one — the
 * Services list expanded a row into a full editor — and two surfaces
 * writing the same columns is how they drift: the same field with two
 * labels, one of them validated, one of them quietly wrong. The list is now
 * a list. This is the service.
 *
 * Not a wizard either, though it is ordered. A wizard owns you until you
 * finish it, and the second service anybody creates does not need walking
 * through anything. So every stage is open at once, any of them can be done
 * in any order, leaving halfway loses nothing, and coming back a year later
 * to change the price lands on the same screen that set it. The order is
 * advice about what to decide first, not a gate.
 *
 * Nothing here is stored. Every stage's state is derived from the service's
 * own fields (see service-setup.ts), so this page cannot disagree with the
 * thing it describes.
 */
export default function ServicePage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const base = `/api/admin/${slug}`;

  const [payload, setPayload] = useState<SetupPayload | null>(null);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>('details');
  // ?tab= opens a tab directly (links from the checklist, Ask khloe, the flow).
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('tab');
    if (asked === 'details' || asked === 'questions' || asked === 'messages' || asked === 'who') setTabState(asked);
  }, []);
  const setTab = (next: Tab) => {
    setTabState(next);
    window.history.replaceState(null, '', `?tab=${next}`);
  };
  const [retiring, setRetiring] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [setup, settings] = await Promise.all([
        adminFetchJson<SetupPayload>(`${base}/service-setup`),
        adminFetchJson<{ settings: { currency: string } }>(`${base}/settings`),
      ]);
      setPayload(setup);
      setCurrency(settings.settings.currency);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const service = payload?.services.find((s) => s.id === id) ?? null;

  if (loading) return <p className="status">Loading…</p>;

  if (error) {
    return (
      <div className="notice notice-error" role="alert">
        {error}
      </div>
    );
  }

  if (!service || !payload) {
    return (
      <>
        <PageHeader title="That service is not here" />
        <p className="notice notice-muted">
          It may have been deleted. <a href={`/admin/${slug}/flow`}>Back to your services</a>.
        </p>
      </>
    );
  }

  const facts: ServiceFacts = {
    id: service.id,
    name: service.name,
    description: service.description,
    durationMinutes: service.durationMinutes,
    priceMinor: service.priceMinor,
    locationKind: service.locationKind,
    locationDetail: service.locationDetail,
    bookingMode: service.bookingMode,
    packSize: service.packSize,
    availableToProspects: service.availableToProspects,
    availableToExistingClients: service.availableToExistingClients,
    ownQuestionCount: service.ownQuestionCount,
    globalQuestionCount: payload.globalQuestionCount,
    availabilityRuleCount: payload.availabilityRuleCount,
    hasOtherPathMessage: payload.hasOtherPathMessage,
    hasOtherPathUrl: payload.hasOtherPathUrl,
  };

  const stages = setupStages(facts);
  const live = service.availableToProspects || service.availableToExistingClients;
  const outstanding = stages.filter((s) => !s.done).length;
  const needed = stages.filter((s) => !s.done && s.blocking).length;

  async function patch(body: Record<string, unknown>) {
    await adminFetchJson(`${base}/event-types/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await load();
  }

  // Which tab holds each stage, so a tab can say when something in it is needed.
  const neededIn = (ids: StageId[]) => stages.some((s) => ids.includes(s.id) && !s.done && s.blocking);
  const tabs: Array<{ id: Tab; label: string; needed: boolean }> = [
    { id: 'details', label: 'Details', needed: neededIn(['service', 'rules', 'availability']) },
    { id: 'questions', label: 'Questions', needed: neededIn(['questions']) },
    { id: 'messages', label: 'Messages', needed: neededIn(['messages']) },
    { id: 'who', label: 'Who can book', needed: neededIn(['review']) },
  ];
  const messagesStage = stages.find((s) => s.id === 'messages');

  return (
    <>
      <PageHeader
        title={service.name}
        description={
          outstanding === 0
            ? 'Everything is set. Change anything, any time.'
            : needed === 0
              ? 'Ready to book. The rest makes it better, whenever you like.'
              : 'A few things to set before people can book it. The tabs marked with a dot need you.'
        }
        actions={
          <a className="btn-secondary" href={`/admin/${slug}/flow?part=service:${service.id}`}>
            How people book it
          </a>
        }
      />

      <AskKhloeBox example={`Change ${service.name} to 30 minutes`} />

      {/* The sentence this whole page exists for: whether anyone can book it. */}
      <div className={`setup-state${live ? ' is-live' : ''}`}>
        <span className="setup-state-mark" aria-hidden="true" />
        <p>
          {live
            ? stages.find((s) => s.id === 'review')!.note
            : 'Not offered to anyone yet. This service does not appear on your booking page.'}{' '}
          {!live && (
            <button type="button" className="btn-link" onClick={() => setTab('who')}>
              Choose who can book it
            </button>
          )}
        </p>
      </div>

      {/* One page per service, its parts as tabs: the same pill switch as
          everywhere else in the admin. The length and price are on the
          first tab, not behind a heading nobody would guess. */}
      <div className="wk-mode svc-tabs" role="tablist" aria-label="About this service">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="filter-chip"
            aria-selected={tab === t.id}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.needed && <span className="svc-tab-dot" aria-label="(needed)" />}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <>
          <section className="card svc-card">
            <div className="admin-card-title">Name and description</div>
            <ServiceStageForm service={service} onSave={patch} />
          </section>
          <section className="card svc-card">
            <div className="admin-card-title">Length, price and place</div>
            <RulesStageForm
              service={service}
              currency={currency}
              takesPayments={!!payload.takesPayments}
              slug={slug}
              onSave={patch}
            />
          </section>
          <section className="card svc-card">
            <div className="admin-card-title">When it can be booked</div>
            <p className="svc-lede">
              Within your opening hours, which every service shares
              {payload.availabilityRuleCount === 0 ? ': you have none yet, so nothing can be booked.' : '.'}
            </p>
            <div className="fl-actions">
              <a className="btn-secondary" href={`/admin/${slug}/account#opening-hours`}>
                Change opening hours
              </a>
              <a className="btn-link" href={`/admin/${slug}/week`}>
                Close a day, or time off, on the Week
              </a>
            </div>
          </section>
        </>
      )}

      {tab === 'questions' && (
        <ServiceQuestions slug={slug} serviceId={service.id} serviceName={service.name} onChanged={() => void load()} />
      )}

      {tab === 'messages' && (
        <section className="card svc-card">
          <div className="admin-card-title">The emails people get</div>
          <p className="svc-lede">
            A confirmation when they book, a reminder the day before, a note if plans change, and a question after.
            They are the same for every service, written in your words on Messages.
          </p>
          {messagesStage?.note && <p className="svc-note">{messagesStage.note}</p>}
          <div className="fl-actions">
            <a className="btn-secondary" href={`/admin/${slug}/messages`}>
              Open Messages
            </a>
          </div>
        </section>
      )}

      {tab === 'who' && (
        <section className="card svc-card">
          <div className="admin-card-title">Who can book it</div>
          <ReviewStageForm service={service} onSave={patch} />
        </section>
      )}

      {tab === 'who' && (
      <>
      {/* Pausing and deleting live at the foot of the service they end, as
          well as on Services. Deleting asks what the rules ask everywhere
          (src/lib/service-deletion.ts): paused first, nothing still coming
          up or owed, and the name typed back. */}
      <div className="service-retire">
        <div>
          <p className="service-retire-label">
            {service.active ? 'Pause this service' : 'This service is paused'}
          </p>
          <p className="service-retire-note">
            {service.active
              ? 'No new appointments can be made. Appointments already booked stay, and those clients can still move or cancel them. You can resume it at any time.'
              : 'No new appointments can be made. Appointments already booked stay. You can resume it, or delete it for good below.'}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={retiring}
          onClick={async () => {
            setRetiring(true);
            try {
              await patch({ active: !service.active });
            } finally {
              setRetiring(false);
            }
          }}
        >
          {retiring ? 'Saving…' : service.active ? 'Pause' : 'Resume'}
        </button>
      </div>

      <div className="service-retire service-delete">
        <div>
          <p className="service-retire-label">Delete this service</p>
          <p className="service-retire-note">
            For good: it can never be resumed, and its settings and its own questions go. Pause it first; it can
            go once nothing is still coming up and nobody still has paid sessions to book. Past appointments
            stay in your history under its name.
          </p>
        </div>
        {!deleting && (
          <button type="button" className="btn-secondary" onClick={() => setDeleting(true)}>
            Delete…
          </button>
        )}
      </div>
      {deleting && (
        <DeleteService
          slug={slug}
          id={service.id}
          name={service.name}
          onCancel={() => setDeleting(false)}
          onDeleted={(note) => {
            window.location.href = `/admin/${slug}/flow?deleted=${encodeURIComponent(note)}`;
          }}
        />
      )}
      </>
      )}
    </>
  );
}

function StageRow({
  stage,
  index,
  slug,
  open,
  onToggle,
  children,
}: {
  stage: Stage;
  index: number;
  slug: string;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const tone = stage.done ? 'is-done' : stage.blocking ? 'is-blocking' : 'is-loose';

  return (
    <li className={`setup-stage ${tone}`}>
      <div className="setup-stage-head">
        {/* Three kinds, said by the mark and a word, not by a number: a
            numbered step without a tick read as unfinished, even when the
            service works and the step only makes it better. */}
        <span className="setup-stage-n" aria-hidden="true">
          {stage.done ? '✓' : stage.blocking ? '!' : '+'}
        </span>
        <div className="setup-stage-main">
          <p className="setup-stage-label">
            {stage.label}
            {!stage.done && (
              <span className={`setup-stage-tag${stage.blocking ? ' is-needed' : ''}`}>
                {stage.blocking ? 'Needed' : 'Optional'}
              </span>
            )}
          </p>
          <p className="setup-stage-purpose">{stage.purpose}</p>
          {stage.note && <p className="setup-stage-note">{stage.note}</p>}
        </div>
        <div className="setup-stage-action">
          {stage.href ? (
            /* Out to the screen that already does this job, rather than a
               second copy of it living here and drifting from the first. */
            <a className="btn-secondary" href={`/admin/${slug}/${stage.href}`}>
              {stage.done ? 'Review' : stage.blocking ? 'Set up' : 'Add'}
            </a>
          ) : (
            <button type="button" className="btn-secondary" onClick={onToggle} aria-expanded={open}>
              {open ? 'Close' : stage.done ? 'Change' : stage.blocking ? 'Set up' : 'Add'}
            </button>
          )}
        </div>
      </div>

      {open && children && <div className="setup-stage-body">{children}</div>}
    </li>
  );
}

/* ── The three stages short enough to live here ────────────────────────── */

type Saver = (body: Record<string, unknown>) => Promise<void>;

function ServiceStageForm({
  service,
  onSave,
}: {
  service: SerializedEventType;
  onSave: Saver;
}) {
  const [name, setName] = useState(service.name);
  const [description, setDescription] = useState(service.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSave({ name, description: description || null });
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="setup-name">Name</label>
        <input
          id="setup-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="setup-description">Description</label>
        <p className="field-description">
          What someone reads under the name when they are choosing between your services.
        </p>
        <textarea
          id="setup-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

function RulesStageForm({
  service,
  currency,
  takesPayments,
  slug,
  onSave,
}: {
  service: SerializedEventType;
  currency: string;
  takesPayments: boolean;
  slug: string;
  onSave: Saver;
}) {
  const [duration, setDuration] = useState(String(service.durationMinutes));
  const [price, setPrice] = useState(toMoneyInput(service.priceMinor, currency));
  const [locationKind, setLocationKind] = useState<ServiceLocationKind | ''>(
    service.locationKind ?? '',
  );
  const [locationDetail, setLocationDetail] = useState(service.locationDetail ?? '');
  const [bookingMode, setBookingMode] = useState<BookingMode>(service.bookingMode);
  const [packSize, setPackSize] = useState(String(service.packSize ?? 10));
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(service.paymentMode);
  const [deposit, setDeposit] = useState(toMoneyInput(service.depositMinor, currency));
  const [priceError, setPriceError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* What a client would be asked to pay, as the form stands now. */
  const parsedPrice = parseOptionalMoney(price, currency);
  const priceNow = parsedPrice.ok ? parsedPrice.minor : null;
  const depositNow = deposit.trim() ? parseMoney(deposit, currency) : null;
  const payable = {
    priceMinor: priceNow,
    paymentMode,
    depositMinor: depositNow,
    bookingMode,
    packSize: bookingMode === 'pack' ? Number(packSize) || null : null,
  };
  const due = amountDue(payable);
  const noPrice = priceNow === null || priceNow <= 0;

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        /* Parsed here, so a typo is a sentence under the field rather than
           a 400 from the server — and so what reaches the API is already
           the integer the column stores. */
        const parsed = parseOptionalMoney(price, currency);
        if (!parsed.ok) {
          setPriceError(priceRefusal(price, currency));
          document.getElementById('setup-price')?.focus();
          return;
        }
        setPriceError(null);
        if (takesPayments) {
          if (paymentMode === 'deposit' && deposit.trim() && depositNow === null) {
            setPaymentError(priceRefusal(deposit, currency));
            return;
          }
          const problem = paymentSettingProblem(payable);
          if (problem) {
            setPaymentError(problem);
            return;
          }
        }
        setPaymentError(null);
        setBusy(true);
        setError(null);
        try {
          await onSave({
            durationMinutes: Number(duration),
            priceMinor: parsed.minor,
            locationKind: locationKind === '' ? null : locationKind,
            locationDetail: locationDetail || null,
            bookingMode,
            packSize: bookingMode === 'pack' ? Number(packSize) : null,
            // Only sent while Stripe is connected: without it the setting
            // cannot change, and what is stored stays as it was.
            ...(takesPayments
              ? {
                  paymentMode,
                  depositMinor: paymentMode === 'deposit' ? depositNow : null,
                }
              : {}),
          });
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="setup-duration">Length (minutes)</label>
        <input
          id="setup-duration"
          type="number"
          min={5}
          max={1440}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="setup-price">Price ({currency})</label>
        <p className="field-description">
          Shown beside the service on your booking page. Leave blank for no published price.
        </p>
        <input
          id="setup-price"
          type="text"
          inputMode="decimal"
          value={price}
          onChange={(e) => {
            setPrice(e.target.value);
            setPriceError(null);
          }}
        />
        {priceError && (
          <p className="field-error" role="alert">
            {priceError}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="setup-location">Where it happens</label>
        <select
          id="setup-location"
          value={locationKind}
          onChange={(e) => setLocationKind(e.target.value as ServiceLocationKind | '')}
        >
          <option value="">Not set</option>
          {LOCATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {locationKind === 'in_person' && (
        <div className="field">
          <label htmlFor="setup-location-detail">Address</label>
          <p className="field-description">
            Carried into the calendar invite as a link to a map.
          </p>
          <input
            id="setup-location-detail"
            type="text"
            value={locationDetail}
            onChange={(e) => setLocationDetail(e.target.value)}
          />
        </div>
      )}

      <div className="field">
        <label>How clients book this</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className={bookingMode === 'single' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setBookingMode('single')}
          >
            Single booking
          </button>
          <button
            type="button"
            className={bookingMode === 'pack' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setBookingMode('pack')}
          >
            Booking pack
          </button>
        </div>
      </div>

      {bookingMode === 'pack' && (
        <div className="field">
          <label htmlFor="setup-pack-size">Bookings in the pack</label>
          <p className="field-description">
            Someone booking this picks all {packSize || 'these'} times at once and is saved as a
            client with that balance.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PACK_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={Number(packSize) === n ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setPackSize(String(n))}
              >
                {n}
              </button>
            ))}
            <input
              id="setup-pack-size"
              type="text"
              inputMode="numeric"
              aria-label="Custom pack size"
              placeholder="Custom"
              style={{ width: 90 }}
              value={PACK_PRESETS.includes(Number(packSize)) ? '' : packSize}
              onChange={(e) => setPackSize(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="field">
        <label>Paid when booking</label>
        {takesPayments ? (
          <>
            <p className="field-description">
              Clients pay on Stripe’s secure page before the time is theirs. The money goes to your
              Stripe account.
            </p>
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 8,
                flexWrap: 'wrap',
              }}
            >
              {(
                [
                  ['none', 'Not online'],
                  ['full', 'Pay in full'],
                  ['deposit', 'Deposit'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={paymentMode === value ? 'btn-primary' : 'btn-secondary'}
                  aria-pressed={paymentMode === value}
                  disabled={value !== 'none' && noPrice}
                  onClick={() => {
                    setPaymentMode(value);
                    setPaymentError(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {paymentMode === 'deposit' && (
              <div style={{ marginTop: 10, maxWidth: 220 }}>
                <label
                  htmlFor="setup-deposit"
                  className="field-description"
                  style={{ display: 'block' }}
                >
                  Deposit ({currency})
                </label>
                <input
                  id="setup-deposit"
                  type="text"
                  inputMode="decimal"
                  value={deposit}
                  onChange={(e) => {
                    setDeposit(e.target.value);
                    setPaymentError(null);
                  }}
                />
              </div>
            )}
            {paymentError ? (
              <p className="field-error" role="alert">
                {paymentError}
              </p>
            ) : noPrice && paymentMode === 'none' ? (
              <p className="field-note">Set a price above to take payment when clients book.</p>
            ) : due ? (
              <p className="field-note">
                {due.kind === 'full'
                  ? `Clients pay ${formatMoney(due.amountMinor, currency)} when they book${due.sessions > 1 ? ` — all ${due.sessions} sessions` : ''}.`
                  : `Clients pay ${formatMoney(due.amountMinor, currency)} when they book, and the other ${formatMoney(due.totalMinor - due.amountMinor, currency)} to you directly.`}{' '}
                Cancelled before your minimum notice: refunded automatically.
              </p>
            ) : paymentMode === 'none' ? (
              <p className="field-note">
                Clients book without paying online. Settle it however you do today.
              </p>
            ) : null}
          </>
        ) : (
          <p className="field-description">
            Not online. To have clients pay when they book,{' '}
            <a href={`/admin/${slug}/account`}>connect Stripe on your Account page</a>.
          </p>
        )}
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

function ReviewStageForm({
  service,
  onSave,
}: {
  service: SerializedEventType;
  onSave: Saver;
}) {
  const [prospects, setProspects] = useState(service.availableToProspects);
  const [clients, setClients] = useState(service.availableToExistingClients);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSave({
            availableToProspects: prospects,
            availableToExistingClients: clients,
          });
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {/* Two independent choices, not two ends of one switch: a service may
          be offered to both, either, or neither. Treating this as a single
          flag was a real bug in an earlier version. */}
      <label className="setup-audience">
        <input
          type="checkbox"
          checked={prospects}
          onChange={(e) => setProspects(e.target.checked)}
        />
        <span>
          <strong>New enquiries</strong>
          <small>Anyone who answers your questions and qualifies.</small>
        </span>
      </label>

      <label className="setup-audience">
        <input type="checkbox" checked={clients} onChange={(e) => setClients(e.target.checked)} />
        <span>
          <strong>Existing clients</strong>
          <small>People booking from their own private link, with no questions to answer.</small>
        </span>
      </label>

      {!prospects && !clients && (
        <p className="notice notice-muted">
          With neither ticked this service exists but nobody can reach it. That is a real choice —
          it is how you keep something ready without offering it yet.
        </p>
      )}

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

/**
 * How this service is recognised on Flow, the Week and in People: its two
 * letters. There is no colour to choose any more — in the admin, colour is
 * kept for what needs you and where you are — so this only shows the mark.
 */
function ServiceIdentity({ service }: { service: SerializedEventType }) {
  const mark = useServiceMark();
  return (
    <div className="svc-identity">
      <ServiceBadge name={service.name} size="lg" />
      <p className="svc-identity-label" style={{ margin: 0 }}>
        Shown as <b>{mark(service.name)}</b> on Services, the Week and People, always beside its name.
      </p>
    </div>
  );
}
