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
import { AskKhloeBox } from '@/components/admin/AskKhloeBox';
import { setupStages, type ServiceFacts, type StageId } from '@/lib/service-setup';
import type { SerializedEventType } from '@/lib/admin-serializers';

interface SetupPayload {
  services: Array<SerializedEventType & { ownQuestionCount: number }>;
  globalQuestionCount: number;
  availabilityRuleCount: number;
  hasOtherPathMessage: boolean;
  hasOtherPathUrl: boolean;
  takesPayments?: boolean;
}

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
  const [hours, setHours] = useState<HoursRule[] | null>(null);
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
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [setup, settings, rules] = await Promise.all([
        adminFetchJson<SetupPayload>(`${base}/service-setup`),
        adminFetchJson<{ settings: { currency: string } }>(`${base}/settings`),
        adminFetchJson<{ rules: HoursRule[] }>(`${base}/availability-rules`).catch(() => null),
      ]);
      setPayload(setup);
      setHours(rules?.rules ?? null);
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
        <ServiceDetails
          slug={slug}
          service={service}
          currency={currency}
          takesPayments={!!payload.takesPayments}
          hours={hours && hours.length > 0 ? hoursSummary(hours) : null}
          packBroken={!!stages.find((st) => st.id === 'rules')?.blocking}
          onSave={patch}
        />
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
        'Anyone who finds your booking page, answers your questions and qualifies.',
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
