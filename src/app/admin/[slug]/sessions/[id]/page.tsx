'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import {
  DEFAULT_CURRENCY,
  parseOptionalMoney,
  priceRefusal,
  toMoneyInput,
} from '@/lib/money';
import { LOCATION_OPTIONS } from '@/lib/service-location';
import { setupStages, type ServiceFacts, type Stage, type StageId } from '@/lib/service-setup';
import type { SerializedEventType } from '@/lib/admin-serializers';
import type { BookingMode, ServiceLocationKind } from '@/lib/db/types';

interface SetupPayload {
  services: Array<SerializedEventType & { ownQuestionCount: number }>;
  globalQuestionCount: number;
  availabilityRuleCount: number;
  hasOtherPathMessage: boolean;
  hasOtherPathUrl: boolean;
}

const PACK_PRESETS = [5, 8, 10];

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
  const [open, setOpen] = useState<StageId | null>(null);
  const [retiring, setRetiring] = useState(false);

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
        <PageHeader eyebrow="Set up" title="That service is not here" />
        <p className="notice notice-muted">
          It may have been archived. <a href={`/admin/${slug}/flow`}>Back to the flow</a>.
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

  async function patch(body: Record<string, unknown>) {
    await adminFetchJson(`${base}/event-types/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await load();
  }

  return (
    <>
      <PageHeader
        /* The eyebrow changes because the page's job does. On a service
           straight out of + Add this is a setup screen; a year later it is
           where you change the price. Same screen, and it should not keep
           calling itself a wizard once there is nothing left to walk
           through. */
        eyebrow={outstanding === 0 ? 'Service' : 'Set up'}
        title={service.name}
        description={
          outstanding === 0
            ? 'Everything is decided. Any of it can still be changed.'
            : 'Work through these in any order. Nothing is lost if you leave and come back.'
        }
        actions={
          <a className="btn-secondary" href={`/admin/${slug}/flow?part=service:${service.id}`}>
            See it in the flow
          </a>
        }
      />

      {/* The sentence this whole page exists for. A service created from the
          Services list is offered to nobody, does not appear on the booking
          page, and until now nothing said so — a business found out days
          later when a client told them. */}
      <div className={`setup-state${live ? ' is-live' : ''}`}>
        <span className="setup-state-mark" aria-hidden="true" />
        <p>
          {live
            ? stages.find((s) => s.id === 'review')!.note
            : 'Not offered to anyone yet. This service does not appear on your booking page.'}
        </p>
      </div>

      <ol className="setup-stages">
        {stages.map((stage, index) => (
          <StageRow
            key={stage.id}
            stage={stage}
            index={index + 1}
            slug={slug}
            open={open === stage.id}
            onToggle={() => setOpen(open === stage.id ? null : stage.id)}
          >
            {stage.id === 'service' && (
              <ServiceStageForm service={service} onSave={patch} />
            )}
            {stage.id === 'rules' && (
              <RulesStageForm service={service} currency={currency} onSave={patch} />
            )}
            {stage.id === 'review' && (
              <ReviewStageForm service={service} onSave={patch} />
            )}
          </StageRow>
        ))}
      </ol>

      {/* Archiving lives at the foot of the service it archives, which is
          where somebody looking for it will be. "Delete" is not offered and
          never has been: a service with a booking against it cannot be
          removed without orphaning history, so archiving is what deleting
          has always meant here — said in the word that is true. */}
      <div className="service-retire">
        <div>
          <p className="service-retire-label">
            {service.active ? 'Stop offering this service' : 'This service is archived'}
          </p>
          <p className="service-retire-note">
            {service.active
              ? 'It comes off your booking page. Everything already booked stays exactly as it is, and you can bring it back at any time.'
              : 'It is off your booking page. Past bookings are untouched.'}
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
          {retiring ? 'Saving…' : service.active ? 'Archive' : 'Restore'}
        </button>
      </div>
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
        <span className="setup-stage-n" aria-hidden="true">
          {stage.done ? '✓' : index}
        </span>
        <div className="setup-stage-main">
          <p className="setup-stage-label">{stage.label}</p>
          <p className="setup-stage-purpose">{stage.purpose}</p>
          {stage.note && <p className="setup-stage-note">{stage.note}</p>}
        </div>
        <div className="setup-stage-action">
          {stage.href ? (
            /* Out to the screen that already does this job, rather than a
               second copy of it living here and drifting from the first. */
            <a className="btn-secondary" href={`/admin/${slug}/${stage.href}`}>
              {stage.done ? 'Review' : 'Set up'}
            </a>
          ) : (
            <button type="button" className="btn-secondary" onClick={onToggle} aria-expanded={open}>
              {open ? 'Close' : stage.done ? 'Change' : 'Set up'}
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
  onSave,
}: {
  service: SerializedEventType;
  currency: string;
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
  const [priceError, setPriceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          });
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="setup-duration">Duration (minutes)</label>
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
