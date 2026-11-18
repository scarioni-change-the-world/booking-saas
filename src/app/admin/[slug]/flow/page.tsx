'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { formatMoney, parseOptionalMoney, toMoneyInput } from '@/lib/money';
import { adminFetchJson } from '@/lib/admin-fetch';
import { ServiceBadge } from '@/components/admin/ServiceBadge';
import { Lamp } from '@/components/admin/Instruments';
import { asksQuestions, buildFlow, laneState, type FlowInput } from '@/lib/flow';
import { LIMIT_REACHED, SERVICE_LIMIT, withinServiceLimit } from '@/lib/service-deletion';
import { openAskKhloe } from '@/components/admin/AskKhloe';
import { SiteDraftPanel } from '@/components/admin/SiteDraft';
import { SERVICE_TYPES, serviceTypeBody, type HoursRule } from '@/lib/setup';

interface NextUp {
  id: string;
  name: string;
  email: string;
  startsAt: string;
  eventTypeId: string;
  eventTypeName: string;
}

interface Payload extends FlowInput {
  timezone: string;
  nextUp: NextUp[];
  branding?: { logo: boolean; colour: boolean; website: boolean };
  setup?: { hours: HoursRule[]; everBooked: boolean; embedded: boolean };
}

/**
 * Your services: one card per service, Add last. A card opens the service's
 * own page, the one place it is set up, paused or deleted. A paused service
 * is a card too, marked Paused. Nothing else lives here: a second view of a
 * service (the old booking-path diagram, its test run, its own pause
 * button) was the same thing in two places.
 */
/** A row's facts in a glance: "30 min · Free", "4 × 1 h · €320". */
function rowFacts(
  s: { durationMinutes: number; priceMinor: number | null; bookingMode: string; packSize: number | null } | undefined,
  currency: string,
): string {
  if (!s) return '';
  const m = s.durationMinutes;
  const length = m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`;
  const shape = s.bookingMode === 'pack' && s.packSize ? `${s.packSize} × ${length}` : length;
  const price = s.priceMinor === null ? null : s.priceMinor === 0 ? 'Free' : formatMoney(s.priceMinor, currency);
  return price ? `${shape} · ${price}` : shape;
}

export default function FlowPage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearchParams();
  /* A deletion from a service's own page comes back here with a note.
     Said once: kept in state, then taken off the address so a refresh does
     not say it again. */
  const [deletedNote] = useState(() => search.get('deleted'));
  useEffect(() => {
    if (deletedNote) window.history.replaceState(null, '', window.location.pathname);
  }, [deletedNote]);

  /* Older links opened a service's diagram here (?service=<id>,
     ?part=service:<id>). A service is its own page now: go there. */
  useEffect(() => {
    const part = search.get('part');
    const id = search.get('service') ?? (part?.startsWith('service:') ? part.slice(8) : null);
    if (id) window.location.replace(`/admin/${slug}/sessions/${encodeURIComponent(id)}`);
  }, [search, slug]);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await adminFetchJson<Payload>(`/api/admin/${slug}/flow`));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const model = useMemo(() => (data ? buildFlow(data) : null), [data]);
  const activeCount = data?.services.filter((s) => s.active).length ?? 0;
  // A new account has one thing to do: add a service. Its card starts open.
  const noServices = !!data && data.services.length === 0;
  useEffect(() => {
    if (noServices) setAdding(true);
  }, [noServices]);

  /** "Add a service": the same card for the first service and every other. */
  function addService() {
    setAdding(true);
    window.setTimeout(
      () => document.getElementById('add-service')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      50,
    );
  }

  const open = (id: string) => window.location.assign(`/admin/${slug}/sessions/${id}`);

  return (
    <>
      <PageHeader title="Your services" />

      {deletedNote && (
        <p className="notice notice-muted" role="status">
          {deletedNote}
        </p>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="status">Loading…</p>}

      {data && model && (
        <section className="fc-services" aria-label="Your services">
          {adding && (
            <AddService
              slug={slug}
              activeCount={activeCount}
              currency={data.tenant.currency}
              hours={data.setup?.hours ?? null}
              first={noServices}
              onAdded={() => {
                setAdding(false);
                void load();
              }}
              onCancel={() => setAdding(false)}
            />
          )}

          {/* One card per service, Add last. A card opens the service's own
              page, where everything about it is set, paused or deleted. */}
          <ul className="fc-tiles">
            {model.lanes.map((l) => {
              const state = laneState(model, l);
              return (
                <li key={l.id}>
                  <button type="button" className="fc-tile" onClick={() => open(l.id)}>
                    <span className="fc-tile-top">
                      <ServiceBadge name={l.name} off={!state.live} />
                      <span className={`fc-state${state.live ? '' : ' is-off'}`}>
                        <Lamp tone={state.live ? 'live' : 'need'} />
                        {state.label}
                      </span>
                    </span>
                    <b className="fc-tile-name">{l.name}</b>
                    <small className="fc-tile-facts">
                      {rowFacts(data.services.find((x) => x.id === l.id), data.tenant.currency)}
                    </small>
                    {/* Figures only when there is something to say. */}
                    {((state.live && l.bookedPeople > 0) || l.owedSessions > 0) && (
                      <span className="fc-tile-figs">
                        {state.live && (
                          <>
                            {l.bookedPeople} booked
                            {l.fromPage && asksQuestions(l) ? ` · ${l.qualified} got through your filters` : ''}
                          </>
                        )}
                        {l.owedSessions > 0 && (
                          <span className="fc-row-owed">
                            {state.live ? ' · ' : ''}
                            {l.owedSessions === 1 ? '1 to book' : `${l.owedSessions} to book`}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {model.archived.map((x) => (
              <li key={x.id}>
                <button type="button" className="fc-tile is-paused" onClick={() => open(x.id)}>
                  <span className="fc-tile-top">
                    <ServiceBadge name={x.name} off />
                    <span className="fc-state is-off">
                      <Lamp tone="off" />
                      Paused
                    </span>
                  </span>
                  <b className="fc-tile-name">{x.name}</b>
                  <small className="fc-tile-facts">No new bookings. Resume or delete it on its page.</small>
                </button>
              </li>
            ))}
            {/* Adding sits where the next service will be. */}
            {!adding && (
              <li>
                <button type="button" className="fc-tile fc-tile-add" onClick={addService}>
                  <span className="fc-tile-plus" aria-hidden="true">
                    +
                  </span>
                  Add a service
                </button>
              </li>
            )}
          </ul>
        </section>
      )}
    </>
  );
}

/* ── A new service ──────────────────────────────────────────────────────── */

/**
 * Naming a service goes straight into setting it up: a name is not a
 * service, and dropping somebody back on the flow with nothing connected
 * would be the product saying "done" about a thing that has not started.
 * Back on Flow, its missing step is drawn as missing.
 */
function AddService({
  slug,
  activeCount,
  currency,
  hours,
  first,
  onAdded,
  onCancel,
}: {
  slug: string;
  activeCount: number;
  currency: string;
  hours: HoursRule[] | null;
  /** The account has no services yet: say hello, and there is no Cancel. */
  first: boolean;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  // Two equal ways in: the three steps, or say it in words and let khloe
  // propose it (nothing is saved until it is confirmed in her panel).
  const [way, setWay] = useState<'self' | 'khloe' | 'site'>('self');
  const [described, setDescribed] = useState('');
  const [typeId, setTypeId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atCap = !withinServiceLimit(activeCount);
  const type = SERVICE_TYPES.find((t) => t.id === typeId) ?? SERVICE_TYPES.find((t) => t.id === 'other')!;

  /** Choosing a kind suggests its name, length and price, unless already typed. */
  function choose(id: string) {
    const previous = SERVICE_TYPES.find((t) => t.id === typeId);
    const next = SERVICE_TYPES.find((t) => t.id === id)!;
    if (!name.trim() || name === previous?.name) setName(next.name);
    setMinutes(String(next.durationMinutes));
    setPrice(next.priceMinor !== undefined ? toMoneyInput(next.priceMinor, currency) : '');
    setTypeId(id);
  }

  const n = Number(minutes);
  const lengthOk = Number.isInteger(n) && n >= 5 && n <= 1440;
  const parsedPrice = parseOptionalMoney(price, currency);

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ eventType: { id: string } }>(`/api/admin/${slug}/event-types`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...serviceTypeBody(type, name),
          durationMinutes: lengthOk ? n : 60,
          priceMinor: parsedPrice.ok ? parsedPrice.minor : null,
        }),
      });
      router.push(`/admin/${slug}/sessions/${result.eventType.id}`);
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  }

  if (atCap) {
    return (
      <div className="card ns" id="add-service">
        <p className="notice notice-muted" style={{ margin: 0 }}>
          {LIMIT_REACHED}
        </p>
        <button type="button" className="btn-link" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }

  return (
    <section className="card ns" id="add-service" aria-label="A new service">
      <div className="ns-top">
        {first ? (
          <div>
            <h2 className="ns-hello">Add your first service</h2>
            <p className="ns-hello-sub">
              What people book with you. Set it up yourself, describe it to khloe, or let khloe read your website.
            </p>
          </div>
        ) : (
          <p className="admin-card-title">
            A new service · {activeCount} of {SERVICE_LIMIT} in use
          </p>
        )}
        {!first && (
          <button type="button" className="btn-link" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <div className="wk-mode ns-way" role="group" aria-label="How to set it up">
        <button type="button" className="filter-chip" aria-pressed={way === 'self'} onClick={() => setWay('self')}>
          Set it up myself
        </button>
        <button type="button" className="filter-chip" aria-pressed={way === 'khloe'} onClick={() => setWay('khloe')}>
          <span aria-hidden="true">✦{'\u00a0'}</span>Describe it to khloe
        </button>
        <button type="button" className="filter-chip" aria-pressed={way === 'site'} onClick={() => setWay('site')}>
          From my website
        </button>
      </div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {way === 'site' ? (
        <SiteDraftPanel slug={slug} currency={currency} room={Math.max(0, SERVICE_LIMIT - activeCount)} onAdded={onAdded} />
      ) : way === 'khloe' ? (
        <form
          className="ns-khloe"
          onSubmit={(e) => {
            e.preventDefault();
            if (!described.trim()) return;
            openAskKhloe(`Add a new service: ${described.trim()}`);
            onCancel();
          }}
        >
          <label htmlFor="ns-describe">Describe the service in your own words</label>
          <textarea
            id="ns-describe"
            rows={3}
            autoFocus
            placeholder="e.g. A 45-minute online coaching call for new clients, €80"
            value={described}
            onChange={(e) => setDescribed(e.target.value)}
          />
          <div className="sp-keys">
            <button type="submit" className="btn-primary" disabled={!described.trim()}>
              Ask khloe
            </button>
            <span className="field-note">khloe proposes it; nothing is saved until you confirm.</span>
          </div>
        </form>
      ) : (
      /* Only what it is and its name: the rest (length, price, when, its
         filters, who can book) are the three steps on its own page, which
         this opens on. Asking for length here too was the same question
         twice. */
      <form
        className="ns-body ns-one"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="ns-kinds" role="radiogroup" aria-label="What kind of service">
          {SERVICE_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={typeId === t.id}
              className="filter-chip"
              aria-pressed={typeId === t.id}
              onClick={() => choose(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="ns-name">Its name</label>
          <input
            id="ns-name"
            type="text"
            placeholder="e.g. Website design"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="sp-keys">
          <button type="submit" className="btn-primary" disabled={!name.trim() || saving}>
            {saving ? 'Adding…' : 'Add it and set it up'}
          </button>
          <span className="field-note">Next: its length, price and when; your filters; who can book.</span>
        </div>
      </form>
      )}
    </section>
  );
}
