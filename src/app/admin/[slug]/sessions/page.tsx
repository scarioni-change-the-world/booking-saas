'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import Toggle from '@/components/admin/Toggle';
import type { SerializedEventType, SerializedSettings } from '@/lib/admin-serializers';
import {
  DEFAULT_CURRENCY,
  formatMoney,
  parseOptionalMoney,
  priceRefusal,
  toMoneyInput,
} from '@/lib/money';
import { LOCATION_OPTIONS, describeLocation } from '@/lib/service-location';
import { businessStages, ownStages, setupStages, summarise } from '@/lib/service-setup';
import type { ServiceLocationKind } from '@/lib/db/types';

/** Up to this many active session types per tenant — a soft, UI-only guide
 * while pricing tiers are still undecided, not a database limit (see the
 * note on the POST route). Matches the reference service builder's own
 * "up to five independent services." */
const SOFT_CAP = 5;

type BookingMode = 'single' | 'pack';

const PACK_PRESETS = [5, 8, 10];

type ServiceWithCounts = SerializedEventType & { ownQuestionCount: number };

interface SharedSetupFacts {
  globalQuestionCount: number;
  availabilityRuleCount: number;
  hasOtherPathMessage: boolean;
  hasOtherPathUrl: boolean;
}

interface SetupPayload extends SharedSetupFacts {
  services: ServiceWithCounts[];
}

function factsFor(service: ServiceWithCounts, shared: SharedSetupFacts) {
  return {
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
    ...shared,
  };
}

/**
 * One row's setup line, or null when there is nothing left to say about
 * this service in particular.
 *
 * Only the stages this service decides for itself. Opening hours are
 * tenant-wide, so without this filter every row on the page led with the
 * same sentence about them and buried what was actually different between
 * them — five services saying one fact five times. The business-wide half
 * is said once, above the list.
 */
function unsetLine(service: ServiceWithCounts, shared: SharedSetupFacts | null): string | null {
  if (!shared) return null;
  return summarise(ownStages(setupStages(factsFor(service, shared))));
}

interface FormState {
  name: string;
  description: string;
  /* Held as the text the person typed, not as a number. Parsing on every
     keystroke would fight them halfway through "60.5", and the value is
     only ever a price at the moment it is saved — see parseOptionalMoney. */
  price: string;
  locationKind: ServiceLocationKind | '';
  locationDetail: string;
  durationMinutes: string;
  bufferBeforeMinutes: string;
  bufferAfterMinutes: string;
  availableToProspects: boolean;
  availableToExistingClients: boolean;
  bookingMode: BookingMode;
  packSize: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  price: '',
  locationKind: '',
  locationDetail: '',
  durationMinutes: '30',
  bufferBeforeMinutes: '0',
  bufferAfterMinutes: '0',
  availableToProspects: false,
  availableToExistingClients: false,
  bookingMode: 'single',
  packSize: '10',
};

function typeToForm(type: SerializedEventType, currency: string): FormState {
  return {
    name: type.name,
    description: type.description ?? '',
    price: toMoneyInput(type.priceMinor, currency),
    locationKind: type.locationKind ?? '',
    locationDetail: type.locationDetail ?? '',
    durationMinutes: String(type.durationMinutes),
    bufferBeforeMinutes: String(type.bufferBeforeMinutes),
    bufferAfterMinutes: String(type.bufferAfterMinutes),
    availableToProspects: type.availableToProspects,
    availableToExistingClients: type.availableToExistingClients,
    bookingMode: type.bookingMode,
    packSize: type.packSize !== null ? String(type.packSize) : '10',
  };
}

function ChevronIcon() {
  return (
    <svg
      className="service-row-chevron"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export default function SessionsPage() {
  const { slug } = useParams<{ slug: string }>();
  const base = `/api/admin/${slug}/event-types`;

  const [types, setTypes] = useState<ServiceWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [quickName, setQuickName] = useState('');
  const [creating, setCreating] = useState(false);
  /* The currency lives on the tenant, not the service (migration 0024), so
     it is loaded once here and every price on the page is read and written
     in it. */
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  /* Held beside the field it belongs to, not in the page-level `error`.
     That one renders at the top of a long list, so a refusal on a form
     three services down was silently off-screen — the form simply did not
     save and said nothing, which is the worst thing a form can do. */
  const [priceError, setPriceError] = useState<string | null>(null);
  /* The tenant-wide half of what setup needs: one question set, one set of
     opening hours, one message for the other path, shared by every row. */
  const [shared, setShared] = useState<SharedSetupFacts | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      /* service-setup rather than event-types: it returns the same rows
         plus the handful of counts this page needs to say what is still
         unset on each of them. One request either way. */
      const [result, settings] = await Promise.all([
        adminFetchJson<SetupPayload>(`/api/admin/${slug}/service-setup`),
        adminFetchJson<{ settings: SerializedSettings }>(`/api/admin/${slug}/settings`),
      ]);
      setTypes(result.services);
      setShared({
        globalQuestionCount: result.globalQuestionCount,
        availabilityRuleCount: result.availabilityRuleCount,
        hasOtherPathMessage: result.hasOtherPathMessage,
        hasOtherPathUrl: result.hasOtherPathUrl,
      });
      setCurrency(settings.settings.currency);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slug is stable for the life of this page
  }, [slug]);

  /* Derived per row rather than stored: a service is as set up as its own
     fields say it is, whether they were filled in through the setup screen
     or by editing the row directly underneath this line. */
  const setupLine = (service: ServiceWithCounts) => unsetLine(service, shared);

  /* Derived from any one service, because these stages do not depend on
     which — they are the business's, not the service's. Blocking ones
     first: a business with no hours has nothing to offer, whatever else is
     set on any row below. */
  const businessGaps =
    shared && types[0]
      ? businessStages(setupStages(factsFor(types[0], shared)))
          .filter((stage) => !stage.done)
          .sort((a, b) => Number(b.blocking) - Number(a.blocking))
      : [];

  const activeCount = types.filter((t) => t.active).length;
  const atCap = activeCount >= SOFT_CAP;

  function openRow(type: SerializedEventType) {
    setExpandedId(type.id);
    setPriceError(null);
    setForm(typeToForm(type, currency));
  }

  function toggleRow(type: SerializedEventType) {
    if (expandedId === type.id) {
      setExpandedId(null);
    } else {
      openRow(type);
    }
  }

  /** The inline "Create a service" row — just a name. The new row lands
   * expanded so duration, buffers, audience and booking mode get filled in
   * right after, instead of a second trip back into a separate form. */
  async function submitQuickCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!quickName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ eventType: SerializedEventType }>(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: quickName.trim() }),
      });
      setQuickName('');
      await load();
      openRow(result.eventType);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function submitEdit(event: React.FormEvent, id: string) {
    event.preventDefault();
    /* Parsed before anything is sent, so a typo is a message under the
       field rather than a 400 from the server — and so the value that
       reaches the API is already the integer the column stores. */
    const price = parseOptionalMoney(form.price, currency);
    if (!price.ok) {
      setPriceError(priceRefusal(form.price, currency));
      // Moved to, not just marked: on a long page the field may be below
      // the fold, and a message nobody scrolls to is the same as none.
      document.getElementById(`edit-price-${id}`)?.focus();
      return;
    }
    setPriceError(null);

    setSaving(true);
    setError(null);
    try {
      await adminFetchJson(`${base}/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          durationMinutes: Number(form.durationMinutes),
          bufferBeforeMinutes: Number(form.bufferBeforeMinutes),
          bufferAfterMinutes: Number(form.bufferAfterMinutes),
          availableToProspects: form.availableToProspects,
          availableToExistingClients: form.availableToExistingClients,
          bookingMode: form.bookingMode,
          packSize: form.bookingMode === 'pack' ? Number(form.packSize) : null,
          priceMinor: price.minor,
          locationKind: form.locationKind === '' ? null : form.locationKind,
          // Cleared with the kind, so an address can never outlive the
          // thing it was describing.
          locationDetail: form.locationKind === '' ? null : form.locationDetail || null,
        }),
      });
      setExpandedId(null);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function flipActive(type: SerializedEventType) {
    setError(null);
    setTypes((prev) =>
      prev.map((t) => (t.id === type.id ? { ...t, active: !t.active } : t)),
    );
    try {
      await adminFetchJson(`${base}/${type.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: !type.active }),
      });
    } catch (cause) {
      setError((cause as Error).message);
      await load();
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Services"
        title="What you offer"
        description="Each service has its own duration, booking rules and — if you want — its own questions."
      />

      {/* The things that are true of every service at once — opening hours,
          and what people sent elsewhere are told. Said here rather than on
          each row, because one set of hours shared by five services is one
          fact, and printing it five times is how a list teaches somebody to
          stop reading it. */}
      {businessGaps.map((stage) => (
        <div key={stage.id} className={`shared-gap${stage.blocking ? ' is-blocking' : ''}`}>
          <p>{stage.note}</p>
          <a className="btn-link" href={`/admin/${slug}/${stage.href}`}>
            {stage.id === 'availability' ? 'Set your hours →' : 'Write it →'}
          </a>
        </div>
      ))}

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="status">Loading…</p>}

      {!loading && (
        <div className="card">
          {types.length === 0 && (
            <p className="notice notice-muted" style={{ margin: '0 0 12px' }}>
              You haven&apos;t added any session types yet.
            </p>
          )}

          <div className="service-list">
            {types.map((type, index) => {
              const expanded = expandedId === type.id;
              return (
                <div key={type.id} className={`service-row${expanded ? ' expanded' : ''}`}>
                  <button
                    type="button"
                    className="service-row-summary"
                    onClick={() => toggleRow(type)}
                    aria-expanded={expanded}
                  >
                    <span className="service-row-num">{String(index + 1).padStart(2, '0')}</span>
                    <span className="service-row-name">
                      {type.name}
                      {!type.active && (
                        <span className="notice notice-muted" style={{ padding: '2px 9px', marginLeft: 10 }}>
                          Archived
                        </span>
                      )}
                    </span>
                    <span className="service-row-meta">
                      {[
                        `${type.durationMinutes} min`,
                        describeLocation(type.locationKind, type.locationDetail),
                        type.priceMinor !== null
                          ? formatMoney(type.priceMinor, currency)
                          : null,
                        type.bookingMode === 'pack' ? `pack of ${type.packSize}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <ChevronIcon />
                  </button>

                  {/* What is still unset on this service, and a way to it.
                   *
                   * This row used to carry a red "Not offered to anyone"
                   * badge, which was right about the fact and wrong about
                   * the tone: a service nobody is offered yet is a draft,
                   * not an error, and red is the colour this product
                   * reserves for something being broken. It also said only
                   * that one thing, when a half-built service is usually
                   * missing several. The sentence comes from the same model
                   * the setup screen uses, so the two cannot disagree. */}
                  {type.active && setupLine(type) && (
                    <div className="service-setup-line">
                      <p>{setupLine(type)}</p>
                      <a className="btn-link" href={`/admin/${slug}/sessions/${type.id}/setup`}>
                        Finish setting up →
                      </a>
                    </div>
                  )}

                  {expanded && (
                    <div className="service-row-body">
                      <form onSubmit={(e) => submitEdit(e, type.id)}>
                        <div className="field">
                          <label htmlFor={`edit-name-${type.id}`}>Name</label>
                          <input
                            id={`edit-name-${type.id}`}
                            type="text"
                            required
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-description-${type.id}`}>Description</label>
                          <textarea
                            id={`edit-description-${type.id}`}
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                          />
                        </div>
                        <div className="admin-field-row">
                          <div className="field">
                            <label htmlFor={`edit-duration-${type.id}`}>Duration (minutes)</label>
                            <input
                              id={`edit-duration-${type.id}`}
                              type="text"
                              inputMode="numeric"
                              required
                              value={form.durationMinutes}
                              onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`edit-buffer-before-${type.id}`}>Buffer before</label>
                            <input
                              id={`edit-buffer-before-${type.id}`}
                              type="text"
                              inputMode="numeric"
                              value={form.bufferBeforeMinutes}
                              onChange={(e) =>
                                setForm({ ...form, bufferBeforeMinutes: e.target.value })
                              }
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`edit-buffer-after-${type.id}`}>Buffer after</label>
                            <input
                              id={`edit-buffer-after-${type.id}`}
                              type="text"
                              inputMode="numeric"
                              value={form.bufferAfterMinutes}
                              onChange={(e) =>
                                setForm({ ...form, bufferAfterMinutes: e.target.value })
                              }
                            />
                          </div>
                        </div>

                        <div className="field">
                          <label>How clients book this service</label>
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <button
                              type="button"
                              className={form.bookingMode === 'single' ? 'btn-primary' : 'btn-secondary'}
                              onClick={() => setForm({ ...form, bookingMode: 'single' })}
                            >
                              Single booking
                            </button>
                            <button
                              type="button"
                              className={form.bookingMode === 'pack' ? 'btn-primary' : 'btn-secondary'}
                              onClick={() => setForm({ ...form, bookingMode: 'pack' })}
                            >
                              Booking pack
                            </button>
                          </div>
                        </div>

                        {form.bookingMode === 'pack' && (
                          <div className="field">
                            <label htmlFor={`edit-pack-size-${type.id}`}>Bookings in the pack</label>
                            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                              {PACK_PRESETS.map((n) => (
                                <button
                                  key={n}
                                  type="button"
                                  className={Number(form.packSize) === n ? 'btn-primary' : 'btn-secondary'}
                                  onClick={() => setForm({ ...form, packSize: String(n) })}
                                >
                                  {n}
                                </button>
                              ))}
                              <input
                                id={`edit-pack-size-${type.id}`}
                                type="text"
                                inputMode="numeric"
                                aria-label="Custom pack size"
                                placeholder="Custom"
                                style={{ width: 90 }}
                                value={PACK_PRESETS.includes(Number(form.packSize)) ? '' : form.packSize}
                                onChange={(e) => setForm({ ...form, packSize: e.target.value })}
                              />
                            </div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--faint)', margin: '8px 0 0' }}>
                              Someone booking this from your booking page picks all{' '}
                              {form.packSize || 'these'} times at once, and is saved as a client
                              with that balance automatically. You can also grant sessions by hand
                              from Clients — for a programme sold in person, say.
                            </p>
                          </div>
                        )}

                        <div className="field">
                          <label htmlFor={`edit-price-${type.id}`}>
                            Price ({currency})
                          </label>
                          <input
                            id={`edit-price-${type.id}`}
                            type="text"
                            inputMode="decimal"
                            placeholder="Leave blank for no published price"
                            aria-invalid={priceError ? true : undefined}
                            aria-describedby={
                              priceError ? `edit-price-error-${type.id}` : undefined
                            }
                            value={form.price}
                            onChange={(e) => {
                              setPriceError(null);
                              setForm({ ...form, price: e.target.value });
                            }}
                          />
                          {priceError && (
                            <p className="field-error" id={`edit-price-error-${type.id}`} role="alert">
                              {priceError}
                            </p>
                          )}
                          <p className="field-note">
                            Shown to clients before they book. Blank means no price is
                            shown at all — which is not the same as free.
                            {form.bookingMode === 'pack' && ' For a pack, this is the price of one session.'}
                          </p>
                        </div>

                        <div className="field">
                          <label htmlFor={`edit-location-kind-${type.id}`}>Where it happens</label>
                          <select
                            id={`edit-location-kind-${type.id}`}
                            value={form.locationKind}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                locationKind: e.target.value as ServiceLocationKind | '',
                              })
                            }
                          >
                            <option value="">Not specified</option>
                            {LOCATION_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Only once there is something for it to describe —
                            an address attached to nothing is a line a client
                            cannot place, and the database refuses it anyway. */}
                        {form.locationKind !== '' && (
                          <div className="field">
                            <label htmlFor={`edit-location-detail-${type.id}`}>
                              {form.locationKind === 'in_person'
                                ? 'Address'
                                : 'Anything else clients should know'}
                            </label>
                            <input
                              id={`edit-location-detail-${type.id}`}
                              type="text"
                              maxLength={300}
                              placeholder={
                                form.locationKind === 'in_person'
                                  ? 'Calle Mayor 4, 2º, Madrid'
                                  : form.locationKind === 'phone'
                                    ? "We'll ring the number you give us"
                                    : 'A video link is sent with the confirmation'
                              }
                              value={form.locationDetail}
                              onChange={(e) =>
                                setForm({ ...form, locationDetail: e.target.value })
                              }
                            />
                            <p className="field-note">Optional.</p>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 28, margin: '18px 0' }}>
                          <Toggle
                            on={form.availableToProspects}
                            label="Offered to new enquiries"
                            onClick={() =>
                              setForm({ ...form, availableToProspects: !form.availableToProspects })
                            }
                          />
                          <Toggle
                            on={form.availableToExistingClients}
                            label="Offered to existing clients"
                            onClick={() =>
                              setForm({
                                ...form,
                                availableToExistingClients: !form.availableToExistingClients,
                              })
                            }
                          />
                        </div>

                        <div className="actions">
                          <button type="submit" className="btn-primary" disabled={saving}>
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => flipActive(type)}
                          >
                            {type.active ? 'Archive' : 'Restore'}
                          </button>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => setExpandedId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <form onSubmit={submitQuickCreate} className="service-create-row">
            <div className="field">
              <label htmlFor="quick-create-name" className="service-create-label">
                Create a service · {activeCount} of {SOFT_CAP} used
              </label>
              <input
                id="quick-create-name"
                type="text"
                placeholder="e.g. Website design"
                disabled={atCap}
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-secondary" disabled={atCap || creating || !quickName.trim()}>
              {creating ? 'Adding…' : '+ Add'}
            </button>
          </form>
          {atCap && (
            <p className="notice notice-muted" style={{ margin: '10px 6px 0' }}>
              You&apos;re using all {SOFT_CAP} session types available right now. Archive one to
              make room for another.
            </p>
          )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          padding: '16px 20px',
          background: 'var(--side)',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          marginTop: 20,
        }}
      >
        <div>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
            The two toggles are independent. A session can be offered to both new enquiries and
            existing clients, either one, or neither — new enquiries answer your
            questions first; existing clients book straight from their own private link.
          </p>
          <a
            href={`/admin/${slug}/screening`}
            className="btn-link"
            style={{ display: 'inline-block', marginTop: 10 }}
          >
            Manage your questions →
          </a>
        </div>
      </div>
    </>
  );
}
