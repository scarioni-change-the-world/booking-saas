'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import Toggle from '@/components/admin/Toggle';
import type { SerializedEventType, SerializedSettings } from '@/lib/admin-serializers';
import { DEFAULT_CURRENCY, formatMoney, parseOptionalMoney, toMoneyInput } from '@/lib/money';
import { LOCATION_OPTIONS, describeLocation } from '@/lib/service-location';
import type { ServiceLocationKind } from '@/lib/db/types';

/** Up to this many active session types per tenant — a soft, UI-only guide
 * while pricing tiers are still undecided, not a database limit (see the
 * note on the POST route). Matches the reference service builder's own
 * "up to five independent services." */
const SOFT_CAP = 5;

type BookingMode = 'single' | 'pack';

const PACK_PRESETS = [5, 8, 10];

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

  const [types, setTypes] = useState<SerializedEventType[]>([]);
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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [result, settings] = await Promise.all([
        adminFetchJson<{ eventTypes: SerializedEventType[] }>(base),
        adminFetchJson<{ settings: SerializedSettings }>(`/api/admin/${slug}/settings`),
      ]);
      setTypes(result.eventTypes);
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

  const activeCount = types.filter((t) => t.active).length;
  const atCap = activeCount >= SOFT_CAP;

  function openRow(type: SerializedEventType) {
    setExpandedId(type.id);
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
      setError(`"${form.price}" is not a price. Leave it blank for no published price.`);
      return;
    }

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
                      {/* Both audience toggles start off, so a session created
                          and saved without touching them is live, valid, and
                          bookable by nobody — the public page just says there
                          is nothing available, which reads as a fault in the
                          page rather than a setting in here. Archived already
                          earns a badge for the same outcome; this deserves one
                          too. */}
                      {type.active &&
                        !type.availableToProspects &&
                        !type.availableToExistingClients && (
                          <span
                            className="notice notice-error"
                            style={{ padding: '2px 9px', marginLeft: 10 }}
                          >
                            Not offered to anyone
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
                              This declares how the pack is meant to be sold — granting the actual
                              sessions to a client still happens from their page on Clients, which
                              will suggest this number as a starting point.
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
                            value={form.price}
                            onChange={(e) => setForm({ ...form, price: e.target.value })}
                          />
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
