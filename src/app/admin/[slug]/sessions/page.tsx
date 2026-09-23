'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import type { SerializedEventType, SerializedSettings } from '@/lib/admin-serializers';
import { DEFAULT_CURRENCY, formatMoney } from '@/lib/money';
import { describeLocation } from '@/lib/service-location';
import { businessStages, ownStages, setupStages, summarise } from '@/lib/service-setup';

/** Up to this many active session types per tenant — a soft, UI-only guide
 * while pricing tiers are still undecided, not a database limit (see the
 * note on the POST route). Matches the reference service builder's own
 * "up to five independent services." */
const SOFT_CAP = 5;

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
    ...shared,
  };
}

/**
 * One row's line, or null when there is nothing left to say about this
 * service in particular.
 *
 * Only the stages this service decides for itself. Opening hours are
 * tenant-wide, so without this filter every row led with the same sentence
 * about them and buried what was actually different between them — five
 * services saying one fact five times. The business-wide half is said once,
 * above the list.
 */
function unsetLine(service: ServiceWithCounts, shared: SharedSetupFacts | null): string | null {
  if (!shared) return null;
  return summarise(ownStages(setupStages(factsFor(service, shared))));
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
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/**
 * What a business offers — a list, and only a list.
 *
 * It used to expand each row into a full editor, which meant every field a
 * service has could be written from two places: here, and the service's own
 * screen. Two surfaces over the same columns is how they come apart — the
 * same field under two labels, one of them validating the price and one of
 * them not, and a person who learns one of them being surprised by the
 * other. One way in, and it is the row itself.
 *
 * What the row keeps is what a list is for: what this service is, at a
 * glance, and whether anything about it still needs deciding.
 */
export default function SessionsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const base = `/api/admin/${slug}/event-types`;

  const [types, setTypes] = useState<ServiceWithCounts[]>([]);
  const [shared, setShared] = useState<SharedSetupFacts | null>(null);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

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

  /**
   * Creating goes straight into the new service, rather than adding a row
   * and leaving.
   *
   * A name is not a service. What + Add produces is thirty minutes long,
   * free, nowhere in particular, asks nothing, and is offered to nobody —
   * and every one of those is a default nobody chose. Dropping somebody
   * back on a list after that is the product saying "done" about a thing
   * that is not started.
   */
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ eventType: SerializedEventType }>(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      router.push(`/admin/${slug}/sessions/${result.eventType.id}`);
    } catch (cause) {
      setError((cause as Error).message);
      setCreating(false);
    }
  }

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
              You haven&apos;t added a service yet. Name one below and we&apos;ll take you
              through the rest.
            </p>
          )}

          <div className="service-list">
            {types.map((type, index) => {
              const line = type.active ? setupLine(type) : null;
              return (
                <a
                  key={type.id}
                  className="service-row-link"
                  href={`/admin/${slug}/sessions/${type.id}`}
                >
                  <span className="service-row-num">{String(index + 1).padStart(2, '0')}</span>
                  <span className="service-row-body-col">
                    <span className="service-row-name">
                      {type.name}
                      {!type.active && (
                        <span
                          className="notice notice-muted"
                          style={{ padding: '2px 9px', marginLeft: 10 }}
                        >
                          Archived
                        </span>
                      )}
                    </span>
                    {/* What is still unset, in the same words the service's
                        own screen uses — one model behind both, so they
                        cannot disagree. */}
                    {line && <span className="service-row-unset">{line}</span>}
                  </span>
                  <span className="service-row-meta">
                    {[
                      `${type.durationMinutes} min`,
                      describeLocation(type.locationKind, type.locationDetail),
                      type.priceMinor !== null ? formatMoney(type.priceMinor, currency) : null,
                      type.bookingMode === 'pack' ? `pack of ${type.packSize}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <ChevronIcon />
                </a>
              );
            })}
          </div>

          <form onSubmit={create} className="service-create-row">
            <div className="field">
              <label htmlFor="new-service-name" className="service-create-label">
                Add a service · {activeCount} of {SOFT_CAP} used
              </label>
              <input
                id="new-service-name"
                type="text"
                placeholder="e.g. Website design"
                disabled={atCap}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={atCap || creating || !newName.trim()}
            >
              {creating ? 'Adding…' : 'Add and set up'}
            </button>
          </form>
          {atCap && (
            <p className="notice notice-muted" style={{ margin: '10px 6px 0' }}>
              You&apos;re using all {SOFT_CAP} services available right now. Archive one to make
              room for another.
            </p>
          )}
        </div>
      )}
    </>
  );
}
