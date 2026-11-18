'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import { DEFAULT_CURRENCY } from '@/lib/money';
import { hoursSummary, type HoursRule } from '@/lib/setup';
import { ServiceDetails } from '@/components/admin/ServiceDetails';
import { SettingForm, SettingsPanel, type Setting } from '@/components/admin/SettingsPanel';
import { DeleteService } from '@/components/admin/DeleteService';
import { ServiceQuestions } from '@/components/admin/ServiceQuestions';
import Toggle from '@/components/admin/Toggle';
import type { PaymentsInfo } from '@/components/admin/BillingCards';
import { setupStages, type ServiceFacts } from '@/lib/service-setup';
import type { SerializedEventType } from '@/lib/admin-serializers';

interface SetupPayload {
  services: Array<SerializedEventType & { ownQuestionCount: number }>;
  globalQuestionCount: number;
  availabilityRuleCount: number;
  hasOtherPathMessage: boolean;
  hasOtherPathUrl: boolean;
  takesPayments?: boolean;
}

/** The three steps, by the names in the address (?tab=) older links use. */
type Tab = 'details' | 'questions' | 'who';
const STEPS: Array<{ id: Tab; n: number; label: string }> = [
  { id: 'details', n: 1, label: 'About it' },
  { id: 'questions', n: 2, label: 'Your filters' },
  { id: 'who', n: 3, label: 'Who can book' },
];

/**
 * A service, set up in three steps on one page: About it, Your filters,
 * Who can book. A new service walks them in order, each ending with its own
 * button (Next, Done with filters, Finish), and Finish puts it on the
 * booking page and says so: "Discovery Call is ready". There is no
 * separate "Offer it": setting a service up means offering it. Once
 * finished, the same three steps are ticked and stay open to change
 * anything, in any order.
 *
 * THE ONLY PLACE A SERVICE IS EDITED. Its emails are the business's, the
 * same for every service, in Your business → Messages; its opening hours
 * are the business's too. Nothing here is stored about the steps
 * themselves: whether it is finished is whether it is offered.
 */
export default function ServicePage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const base = `/api/admin/${slug}`;

  const [payload, setPayload] = useState<SetupPayload | null>(null);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [hours, setHours] = useState<HoursRule[] | null>(null);
  const [account, setAccount] = useState<{ timezone: string; payments: PaymentsInfo } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>('details');
  // Which Details line opens first (?open=when from elsewhere).
  const [openLine, setOpenLine] = useState<string | undefined>(undefined);
  // How far a new service has been walked: 1 after Next, 2 after the filters.
  const [reached, setReached] = useState(0);
  const [justFinished, setJustFinished] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const asked = params.get('tab');
    if (asked === 'questions' || asked === 'who') setTabState(asked);
    const line = params.get('open');
    if (line && /^[a-z]+$/.test(line)) setOpenLine(line);
  }, []);
  const setTab = (next: Tab) => {
    setTabState(next);
    window.history.replaceState(null, '', `?tab=${next}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const [setup, settings, rules, acct] = await Promise.all([
        adminFetchJson<SetupPayload>(`${base}/service-setup`),
        adminFetchJson<{ settings: { currency: string } }>(`${base}/settings`),
        adminFetchJson<{ rules: HoursRule[] }>(`${base}/availability-rules`).catch(() => null),
        adminFetchJson<{ business: { timezone: string }; payments: PaymentsInfo }>(`${base}/account`).catch(() => null),
      ]);
      setPayload(setup);
      setHours(rules?.rules ?? null);
      setAccount(acct ? { timezone: acct.business.timezone, payments: acct.payments } : null);
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
  // Finished is offered (or paused after being offered): nothing else is stored.
  const finished = live || !service.active;
  const packBroken = !!stages.find((st) => st.id === 'rules')?.blocking;
  const noHours = payload.availabilityRuleCount === 0;
  const filterCount = service.ownQuestionCount + payload.globalQuestionCount;

  async function patch(body: Record<string, unknown>) {
    await adminFetchJson(`${base}/event-types/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await load();
  }

  const done = (t: Tab) =>
    finished || (t === 'details' ? reached >= 1 && !packBroken : t === 'questions' ? reached >= 2 : false);
  const stepOf = STEPS.findIndex((s) => s.id === tab) + 1;

  const go = (next: Tab, reach: number) => {
    setReached((r) => Math.max(r, reach));
    setTab(next);
  };

  return (
    <>
      <PageHeader title={service.name} description={<Status slug={slug} service={service} finished={finished} step={stepOf} />} />

      {justFinished && (
        <Ready slug={slug} service={service} filterCount={filterCount} onClose={() => setJustFinished(false)} />
      )}

      {/* The three steps: numbered, ticked when done. The same pill switch
          as everywhere else, and any step can be opened at any time. */}
      <nav className="wk-mode svc-tabs svc-steps" aria-label="Setting up this service">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="filter-chip"
            aria-pressed={tab === s.id}
            aria-current={tab === s.id ? 'step' : undefined}
            onClick={() => setTab(s.id)}
          >
            <span className={`svc-step-n${done(s.id) ? ' is-done' : ''}`} aria-hidden="true">
              {done(s.id) ? '✓' : s.n}
            </span>
            {s.label}
            {done(s.id) && <span className="sr-only"> (done)</span>}
          </button>
        ))}
      </nav>

      {tab === 'details' && (
        <>
          <ServiceDetails
            slug={slug}
            service={service}
            currency={currency}
            takesPayments={!!payload.takesPayments}
            hours={hours && hours.length > 0 ? hoursSummary(hours) : null}
            openingRules={hours ?? []}
            packBroken={packBroken}
            onSave={patch}
            account={account}
            onAccountChanged={load}
            open={openLine}
          />
          {!finished && (
            <div className="svc-next">
              <button type="button" className="btn-secondary is-need" onClick={() => go('questions', 1)}>
                Next: your filters
              </button>
            </div>
          )}
        </>
      )}

      {tab === 'questions' && (
        <>
          <ServiceQuestions slug={slug} serviceId={service.id} serviceName={service.name} onChanged={() => void load()} />
          {!finished && (
            <div className="svc-next">
              <button type="button" className="btn-secondary is-need" onClick={() => go('who', 2)}>
                {filterCount > 0 ? 'Done with filters' : 'Next: who can book'}
              </button>
              {filterCount === 0 && <span className="field-note">No filters: everyone goes straight to the calendar.</span>}
            </div>
          )}
        </>
      )}

      {tab === 'who' &&
        (!finished ? (
          <FinishStep
            slug={slug}
            noHours={noHours}
            packBroken={packBroken}
            onPack={() => {
              setOpenLine('booked');
              setTab('details');
            }}
            onFinish={async (prospects, clients) => {
              await patch({ availableToProspects: prospects, availableToExistingClients: clients });
              setReached(3);
              setJustFinished(true);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        ) : (
          <>
            <WhoCanBook service={service} live={live} onSave={patch} />

            {/* Deleting stays at the foot, apart: the one thing here that cannot
                be undone. It asks what the rules ask everywhere
                (src/lib/service-deletion.ts): paused first, nothing still coming
                up or owed, and the name typed back. */}
            <div className="service-retire service-delete">
              <div>
                <p className="service-retire-label">Delete this service</p>
                <p className="service-retire-note">
                  For good: it can never be resumed, and its settings and its own filters go. Pause it first; it can
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
        ))}
    </>
  );
}

/** Under the name: ready, paused, or which step of three it is on. */
function Status({
  slug,
  service,
  finished,
  step,
}: {
  slug: string;
  service: SerializedEventType;
  finished: boolean;
  step: number;
}) {
  if (!service.active) {
    return (
      <>
        <span className="svc-off-dot" aria-hidden="true" />
        Paused: no new bookings. Resume it under Who can book.
      </>
    );
  }
  if (finished) {
    const where = service.availableToProspects
      ? service.availableToExistingClients
        ? 'on your booking page, and your clients can book it from their own link'
        : 'on your booking page'
      : 'for your existing clients, from their own link';
    return (
      <>
        <span className="svc-on-dot" aria-hidden="true" />
        Ready: {where}.{' '}
        {service.availableToProspects && (
          <a href={`/${slug}?service=${encodeURIComponent(service.slug)}`} target="_blank" rel="noreferrer">
            See it as a client
          </a>
        )}
      </>
    );
  }
  return (
    <>
      <span className="svc-off-dot" aria-hidden="true" />
      Not finished yet: step {step} of 3. Nobody can book it until you finish.
    </>
  );
}

/** Step 3 for a new service: who can book it, then Finish. */
function FinishStep({
  slug,
  noHours,
  packBroken,
  onPack,
  onFinish,
}: {
  slug: string;
  noHours: boolean;
  packBroken: boolean;
  onPack: () => void;
  onFinish: (prospects: boolean, clients: boolean) => Promise<void>;
}) {
  const [prospects, setProspects] = useState(true);
  const [clients, setClients] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = noHours || packBroken || (!prospects && !clients);

  return (
    <section className="card svc-card svc-finish">
      <div className="admin-card-title">Who can book it</div>
      <div className="svc-who">
        <div className="svc-who-row">
          <div>
            <b>New enquiries</b>
            <small>From your booking page, after your filters.</small>
          </div>
          <Toggle on={prospects} label={prospects ? 'Can book' : 'Cannot book'} onClick={() => setProspects(!prospects)} />
        </div>
        <div className="svc-who-row">
          <div>
            <b>Existing clients</b>
            <small>From their own private link, with no filters.</small>
          </div>
          <Toggle on={clients} label={clients ? 'Can book' : 'Cannot book'} onClick={() => setClients(!clients)} />
        </div>
      </div>
      {noHours && (
        <p className="notice notice-muted">
          You have no opening hours yet, so nobody could book it.{' '}
          <a href={`/admin/${slug}/account#opening-hours`}>Set them in Your business</a>, then come back to finish.
        </p>
      )}
      {packBroken && (
        <p className="notice notice-muted">
          It is booked as a pack, but the pack has no size.{' '}
          <button type="button" className="btn-link" onClick={onPack}>
            Choose how many sessions
          </button>
          .
        </p>
      )}
      {!prospects && !clients && <p className="field-note">Choose at least one, or nobody can book it.</p>}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="svc-next">
        <button
          type="button"
          className="btn-secondary is-need"
          disabled={blocked || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onFinish(prospects, clients);
            } catch (cause) {
              setError((cause as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? 'Finishing…' : 'Finish'}
        </button>
        <span className="field-note">Puts it on your booking page.</span>
      </div>
    </section>
  );
}

/** Said once, when a service is finished: it is ready, and how to share it. */
function Ready({
  slug,
  service,
  filterCount,
  onClose,
}: {
  slug: string;
  service: SerializedEventType;
  filterCount: number;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => setUrl(`${window.location.origin}/${slug}?service=${encodeURIComponent(service.slug)}`), [slug, service.slug]);

  return (
    <section className="svc-ready" role="status" aria-live="polite">
      <div className="svc-ready-head">
        <p className="svc-ready-title">
          <span aria-hidden="true">✓ </span>
          {service.name} is ready
        </p>
        <button type="button" className="btn-link" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="svc-ready-sub">
        {service.availableToProspects
          ? `It is on your booking page${filterCount > 0 ? `, after your ${filterCount === 1 ? 'filter' : `${filterCount} filters`}` : ''}.`
          : 'Your existing clients can book it from their own link.'}
      </p>
      {service.availableToProspects && (
        <>
          <code className="svc-ready-link">{url}</code>
          <div className="svc-next">
            <button
              type="button"
              className="btn-secondary is-need"
              disabled={!url}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                } catch {
                  window.prompt('Copy this link:', url);
                }
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a href={url} target="_blank" rel="noreferrer">
              See it as a client
            </a>
            <a href={`/admin/${slug}/share?service=${encodeURIComponent(service.id)}`}>Put it on your website</a>
          </div>
        </>
      )}
    </section>
  );
}

type Saver = (body: Record<string, unknown>) => Promise<void>;

/**
 * Who can book it, and whether it is taking bookings at all: one line each.
 * New enquiries and existing clients are two independent choices, not two
 * ends of one switch: a service may be offered to both, either, or neither.
 */
function WhoCanBook({ service, live, onSave }: { service: SerializedEventType; live: boolean; onSave: Saver }) {
  const offer = (key: 'availableToProspects' | 'availableToExistingClients', who: string, how: string) => (
    <OfferEditor
      key={`${key}-${service[key]}`}
      on={service[key]}
      purpose={how}
      who={who}
      save={(on) => onSave({ [key]: on })}
    />
  );
  const settings: Setting[] = [
    {
      id: 'prospects',
      label: 'New enquiries',
      value: service.availableToProspects ? 'Can book' : 'Cannot book',
      empty: !service.availableToProspects,
      needed: !live,
      editor: offer(
        'availableToProspects',
        'new enquiries',
        'Anyone who finds your booking page and gets through your filters.',
      ),
    },
    {
      id: 'clients',
      label: 'Existing clients',
      value: service.availableToExistingClients ? 'Can book' : 'Cannot book',
      empty: !service.availableToExistingClients,
      editor: offer(
        'availableToExistingClients',
        'existing clients',
        'People booking from their own private link, with no questions to answer.',
      ),
    },
    {
      id: 'status',
      label: 'Status',
      value: service.active ? 'Taking bookings' : 'Paused',
      empty: !service.active,
      editor: <PauseEditor key={String(service.active)} active={service.active} save={(active) => onSave({ active })} />,
    },
  ];
  return <SettingsPanel label="Who can book it" settings={settings} />;
}

function OfferEditor({
  on,
  who,
  purpose,
  save,
}: {
  on: boolean;
  who: string;
  purpose: string;
  save: (on: boolean) => Promise<void>;
}) {
  const [value, setValue] = useState(on);
  return (
    <SettingForm purpose={purpose} dirty={value !== on} save={() => save(value)}>
      <div className="wk-mode" role="group" aria-label={`Can ${who} book it?`}>
        <button type="button" className="filter-chip" aria-pressed={value} onClick={() => setValue(true)}>
          Can book
        </button>
        <button type="button" className="filter-chip" aria-pressed={!value} onClick={() => setValue(false)}>
          Cannot book
        </button>
      </div>
    </SettingForm>
  );
}

function PauseEditor({ active, save }: { active: boolean; save: (active: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="sp-form">
      <p className="sp-purpose">
        {active
          ? 'Pausing stops new bookings. Those already made stay, and those clients can still move or cancel them. You can resume it at any time.'
          : 'Paused: no new bookings. Those already made stay. Resume it, or delete it for good below.'}
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await save(!active);
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : active ? 'Pause' : 'Resume'}
      </button>
    </div>
  );
}
