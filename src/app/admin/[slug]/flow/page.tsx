'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { PageHeader } from '@/components/ui';
import { formatMoney, parseOptionalMoney, toMoneyInput } from '@/lib/money';
import { adminFetchJson } from '@/lib/admin-fetch';
import { share } from '@/lib/enquiry-analysis';
import { ServiceBadge } from '@/components/admin/ServiceBadge';
import { Dial, Grille, Lamp } from '@/components/admin/Instruments';
import {
  asksQuestions,
  buildFlow,
  laneState,
  readout,
  serviceSteps,
  settingsNeeds,
  stepForPart,
  type FlowInput,
  type FlowModel,
  type FlowStep,
  type Lane,
  type StepId,
} from '@/lib/flow';
import { partForPhase, type TestMessage } from '@/lib/test-run';
import { LIMIT_REACHED, SERVICE_LIMIT, withinServiceLimit } from '@/lib/service-deletion';
import { DeleteService } from '@/components/admin/DeleteService';
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

interface Walked {
  steps: Set<StepId>;
  current: StepId | null;
  /** The test run was sent to the other next step. */
  elsewhere: boolean;
}

const START: Walked = { steps: new Set(['find']), current: 'find', elsewhere: false };

/**
 * Flow: each service as the path people take to book it.
 *
 * Every service is a row floating on the page, with its numbers; adding one
 * is a button beside the title. Choosing a service opens its flow right
 * under its row, in its own card, like a drop-down: four
 * numbered chips — your page, questions, choose a time, booked — each with
 * one count of people and, when something needs doing, a few words saying
 * so. A step that stops the service is said in a sentence above the chips,
 * with the button that fixes it. Choosing a chip opens its detail, its
 * problems in full and the way to change it, in one panel under them.
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
  /* A deletion from a service's own settings page comes back here with a
     note. Said once: kept in state, then taken off the address so a
     refresh does not say it again. */
  const [deletedNote] = useState(() => search.get('deleted'));
  useEffect(() => {
    if (deletedNote) window.history.replaceState(null, '', window.location.pathname);
  }, [deletedNote]);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Seeded from the address, so a link elsewhere can open a service or one
     of its steps: ?service=<id>, or the older ?part=questions and
     ?part=service:<id>, which still work. */
  const seededPart = search.get('part');
  const [laneId, setLaneId] = useState<string | null>(
    () => search.get('service') ?? (seededPart?.startsWith('service:') ? seededPart.slice(8) : null),
  );
  const [openStep, setOpenStep] = useState<StepId | null>(() =>
    seededPart?.startsWith('service:') ? null : stepForPart(seededPart),
  );
  const [adding, setAdding] = useState(false);
  const [trying, setTrying] = useState(false);
  const [walked, setWalked] = useState<Walked>(START);

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
  /* A service's flow opens when it is chosen, and closes when it is chosen
     again. With only one service there is nothing to choose between, so
     it starts open. */
  const lane = model?.lanes.find((l) => l.id === laneId) ?? null;
  useEffect(() => {
    if (model && model.lanes.length === 1 && laneId === null) setLaneId(model.lanes[0]!.id);
    // Only when the services arrive: closing it afterwards must stay closed.
  }, [model]);
  const steps = useMemo(() => (model && lane ? serviceSteps(model, lane, slug) : []), [model, lane, slug]);
  const opened = steps.find((st) => st.id === openStep) ?? null;

  /* The test run reports each step it reaches. Only from this app's own
     origin: anything else posting into this window is ignored. */
  useEffect(() => {
    if (!trying || !model) return;
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const msg = event.data as TestMessage;
      if (!msg || msg.type !== 'khloe:test') return;
      const chosen = msg.eventTypeId ? model!.lanes.find((l) => l.id === msg.eventTypeId) : null;
      if (chosen) setLaneId(chosen.id);
      const part = partForPhase(msg.phase);
      const step = stepForPart(part);
      setWalked((prev) => {
        const fresh = msg.phase === 'service' || msg.phase === 'loading';
        const reached = fresh ? new Set<StepId>(['find']) : new Set(prev.steps);
        /* Every step before the one reached was passed on the way. */
        const order: StepId[] = ['find', 'questions', 'times', 'booked'];
        if (step) for (const id of order.slice(0, order.indexOf(step) + 1)) reached.add(id);
        return {
          steps: reached,
          current: step ?? 'find',
          elsewhere: part === 'elsewhere' ? true : fresh ? false : prev.elsewhere,
        };
      });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [trying, model]);

  function chooseLane(id: string) {
    setLaneId((cur) => (cur === id ? null : id));
    setOpenStep(null);
  }

  function startTrying() {
    setOpenStep(null);
    setWalked(START);
    setTrying(true);
  }

  const activeCount = data?.services.filter((s) => s.active).length ?? 0;
  // A new account has one thing to do: add a service. Its card starts open.
  const noServices = !!data && data.services.length === 0;
  useEffect(() => {
    if (noServices) setAdding(true);
  }, [noServices]);
  const a = (path: string) => `/admin/${slug}/${path}`;

  /* The chosen service's flow, opened right under its row like a drop-down. */
  function renderFlow(model: FlowModel, lane: Lane, data: Payload) {
    return (
      <section
        id="fc-flow"
        className="fc-card fc-flow"
        aria-labelledby="fc-flow-title"
      >
        <div className="fc-card-head">
          <div className="fc-flow-title">
            <div>
              <p className="fc-eyebrow">How people book it · last 30 days</p>
              <h2 id="fc-flow-title">{lane.name}</h2>
            </div>
          </div>
          <div className="fl-actions">
            {trying ? (
              <button type="button" className="btn-secondary" onClick={() => setTrying(false)}>
                Stop the test
              </button>
            ) : (
              <>
                {/* The real booking page, in a test run that saves and
                    sends nothing, with these steps lighting up as it
                    is walked: a test of this flow, so it sits here. */}
                <button type="button" className="btn-secondary" onClick={startTrying}>
                  Test as a client
                </button>
                {/* Ochre while the settings are still waiting for something —
                    a price, a place, a description, who it is offered to —
                    and the reason is said to anyone who asks. */}
                {(() => {
                  const needs = settingsNeeds(lane).map((st) => st.note).join(' ');
                  return (
                    <a
                      className={`btn-secondary${needs ? ' is-need' : ''}`}
                      href={a(`sessions/${lane.id}`)}
                      title={needs || undefined}
                    >
                      Service settings
                      {needs && <span className="sr-only"> — {needs}</span>}
                    </a>
                  );
                })()}
              </>
            )}
          </div>
        </div>

        {(() => {
          const missing = steps.find((st) => st.state === 'missing');
          if (!missing || trying) return null;
          return (
            <div className="fc-callout" role="status">
              <span>{readout(model, lane).text}</span>
              {missing.change && (
                <a className="btn-primary" href={a(missing.change.href)}>
                  {missing.change.label}
                </a>
              )}
            </div>
          );
        })()}

        <ol className="fc-path" aria-label={`How people book ${lane.name}`}>
          {steps.map((st, i) => (
            <li key={st.id}>
              <button
                type="button"
                className={`fc-step is-${st.state}${openStep === st.id ? ' is-open' : ''}${trying && walked.steps.has(st.id) ? ' is-lit' : ''}${trying && walked.current === st.id ? ' is-here' : ''}`}
                aria-expanded={openStep === st.id}
                aria-controls="fc-panel"
                onClick={() => setOpenStep((cur) => (cur === st.id ? null : st.id))}
                disabled={trying}
              >
                <span className="fc-label">
                  {i + 1} · {st.label}
                </span>
                <StepReadout step={st} lane={lane} />
                <span className="fc-step-foot">
                  {st.flag && (
                    <span className="fc-flag">
                      <Lamp tone="need" />
                      {st.flag}
                    </span>
                  )}
                  {trying && walked.current === st.id && (
                    <span className="fc-flag is-here">
                      <Lamp tone="here" />
                      {walked.elsewhere && st.id === 'questions' ? 'Sent elsewhere' : 'The test is here'}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>

        {trying && <TryLegend walked={walked} lane={lane} />}

        {!trying && opened && (
          <StepPanel step={opened} slug={slug} onClose={() => setOpenStep(null)}>
            <StepDetail id={opened.id} model={model} lane={lane} data={data} slug={slug} />
          </StepPanel>
        )}

        {/* The hint and the way to pause, on one line under the path. */}
        {!trying && (
          <div className="fc-foot">
            {!opened && <p className="fc-hint">Choose a step to see more, or to change it.</p>}
            <PauseService
              key={lane.id}
              slug={slug}
              lane={lane}
              onPaused={() => {
                setLaneId(null);
                setOpenStep(null);
                void load();
              }}
            />
          </div>
        )}
      </section>
    );
  }

  /** "Add a service": the same card for the first service and every other. */
  function addService() {
    setAdding(true);
    window.setTimeout(
      () => document.getElementById('add-service')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      50,
    );
  }


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
        <div className={trying ? 'fl-try-layout' : undefined}>
          <div className="fc-stack">
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

              {(
                <>
                  <ul className="fc-tiles">
                    {model.lanes.map((l) => {
                      const state = laneState(model, l);
                      const isOpen = lane?.id === l.id;
                      return (
                        <li key={l.id}>
                          <button
                            type="button"
                            className={`fc-tile${isOpen ? ' is-open' : ''}`}
                            /* A service opens its own page, where everything
                               about it is edited. Its booking path, the
                               diagram, opens from there ("How people book
                               it") and shows under these cards. */
                            onClick={() =>
                              isOpen ? chooseLane(l.id) : window.location.assign(`/admin/${slug}/sessions/${l.id}`)
                            }
                            disabled={trying && !isOpen}
                          >
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
                                    {l.fromPage && asksQuestions(l) ? ` · ${l.qualified} could book` : ''}
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
                    {/* Adding sits where the next service will be. */}
                    {!trying && !adding && (
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
                  {/* A service's booking path opens under the cards, full
                      width, so no card moves. */}
                  {lane && model.lanes.some((l) => l.id === lane.id) && renderFlow(model, lane, data)}
                </>
              )}

            </section>

            {/* Below the open flow, so nothing comes between a service and
                the flow it opens. */}
            {!trying && model.archived.length > 0 && (
              <PausedServices
                slug={slug}
                paused={model.archived}
                activeCount={activeCount}
                onChanged={() => void load()}
              />
            )}
          </div>

          {trying && <TryPanel slug={slug} onRestart={() => setWalked(START)} />}
        </div>
      )}
    </>
  );
}

/* ── Pausing a service, resuming it, deleting it ────────────────────────── */

async function setActive(slug: string, id: string, active: boolean) {
  await adminFetchJson(`/api/admin/${slug}/event-types/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ active }),
  });
}

/**
 * Pausing: no new appointments can be made. Allowed at any time — whoever
 * already booked keeps their appointment and can still move or cancel it
 * (see src/lib/service-deletion.ts). Asked once, in place.
 */
function PauseService({ slug, lane, onPaused }: { slug: string; lane: Lane; onPaused: () => void }) {
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pause() {
    setSaving(true);
    setError(null);
    try {
      await setActive(slug, lane.id, false);
      onPaused();
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className={`fc-archive${asking ? ' is-asking' : ''}`}>
      {asking ? (
        <>
          <p>
            <b>Pause {lane.name}?</b> No new appointments can be made. Appointments already booked stay, and those
            clients can still move or cancel them. You can resume it at any time.
          </p>
          <div className="fl-actions">
            <button type="button" className="btn-primary" onClick={() => void pause()} disabled={saving}>
              {saving ? 'Pausing…' : 'Pause it'}
            </button>
            <button type="button" className="btn-link" onClick={() => setAsking(false)} disabled={saving}>
              Keep it open
            </button>
          </div>
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <button type="button" className="btn-link" onClick={() => setAsking(true)}>
          Pause this service
        </button>
      )}
    </div>
  );
}

function PausedServices({
  slug,
  paused,
  activeCount,
  onChanged,
}: {
  slug: string;
  paused: Array<{ id: string; name: string }>;
  activeCount: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const full = !withinServiceLimit(activeCount);

  async function resume(id: string) {
    setBusy(id);
    setError(null);
    try {
      await setActive(slug, id, true);
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fc-archived">
      <p className="fc-eyebrow">Paused</p>
      {done && (
        <p className="notice notice-muted" role="status">
          {done}
        </p>
      )}
      <ul>
        {paused.map((x) => (
          <li key={x.id} className={deleting === x.id ? 'is-deleting' : undefined}>
            <div className="fc-paused-row">
              <Lamp tone="off" />
              <span>
                <b>{x.name}</b>
                <small>No new appointments. Ones already booked stay.</small>
              </span>
              <span className="fl-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void resume(x.id)}
                  disabled={busy !== null || full}
                  title={full ? LIMIT_REACHED : undefined}
                >
                  {busy === x.id ? 'Resuming…' : 'Resume'}
                </button>
                <button
                  type="button"
                  className="btn-link"
                  aria-expanded={deleting === x.id}
                  onClick={() => setDeleting((cur) => (cur === x.id ? null : x.id))}
                >
                  Delete…
                </button>
              </span>
            </div>
            {deleting === x.id && (
              <DeleteService
                slug={slug}
                id={x.id}
                name={x.name}
                onCancel={() => setDeleting(null)}
                onDeleted={(note) => {
                  setDeleting(null);
                  setDone(note);
                  onChanged();
                }}
              />
            )}
          </li>
        ))}
      </ul>
      {full && <p className="fc-hint">{LIMIT_REACHED}</p>}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ── What a step reads out ──────────────────────────────────────────────── */

/**
 * A step's one number, read the way its instrument reads it: a large
 * figure for a count, a dial for the share who finished the questions,
 * and for Booked, a grille with one dot for each person who chose the
 * service — lit for the ones who booked.
 */
function StepReadout({ step, lane }: { step: FlowStep; lane: Lane }) {
  if (!step.figure) {
    return <span className={`fc-short${step.state === 'missing' ? ' is-need' : ''}`}>{step.short}</span>;
  }
  const caption = (
    <span className="fc-caption">
      {step.figure.label}
      {step.figure.sub ? ` · ${step.figure.sub}` : ''}
    </span>
  );
  if (step.id === 'questions' && lane.started > 0) {
    return (
      <>
        <Dial
          part={lane.finished}
          whole={lane.started}
          label={`${lane.finished} of the ${lane.started} who started finished the questions`}
        />
        <span className="fc-caption">
          finished{lane.sentElsewhere > 0 ? ` · ${lane.sentElsewhere} sent elsewhere` : ''}
        </span>
      </>
    );
  }
  if (step.id === 'booked') {
    const lit = Math.min(lane.bookedPeopleNew, lane.started);
    return (
      <>
        <span className="fc-value-line">
          <b className="fc-value">{step.figure.value}</b>
          {caption}
        </span>
        <Grille
          lit={lit}
          of={lane.fromPage ? lane.started : 0}
          label={`${lit} of the ${lane.started} who chose it on your page booked`}
        />
      </>
    );
  }
  return (
    <>
      <b className="fc-value">{step.figure.value}</b>
      {caption}
    </>
  );
}

/* ── A chosen step, opened under the path ───────────────────────────────── */

function StepPanel({
  step,
  slug,
  onClose,
  children,
}: {
  step: FlowStep;
  slug: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const a = (path: string) => `/admin/${slug}/${path}`;
  return (
    <section id="fc-panel" className="fc-panel" aria-label={step.title}>
      <div className="fc-panel-head">
        <div>
          <h2>{step.title}</h2>
          <p>{step.detail}</p>
        </div>
        <div className="fc-panel-actions">
          {step.change && (
            <a className="btn-secondary" href={a(step.change.href)}>
              {step.change.label}
            </a>
          )}
          <button type="button" className="btn-link" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {step.notes.length > 0 && (
        <ul className="fc-notes">
          {step.notes.map((n) => (
            <li key={n.text} className={n.tone === 'need' ? 'is-need' : undefined}>
              <span>{n.text}</span>
              {n.action && <a href={a(n.action.href)}>{n.action.label}</a>}
            </li>
          ))}
        </ul>
      )}
      {step.state !== 'skipped' && step.state !== 'waiting' && children}
    </section>
  );
}

/* ── What each step's panel holds ───────────────────────────────────────── */

function StepDetail({
  id,
  model,
  lane,
  data,
  slug,
}: {
  id: StepId;
  model: FlowModel;
  lane: Lane;
  data: Payload;
  slug: string;
}) {
  const a = (path: string) => `/admin/${slug}/${path}`;

  if (id === 'find') return <FindDetail slug={slug} model={model} lane={lane} />;

  if (id === 'questions') {
    if (!lane.fromPage || !asksQuestions(lane)) {
      return (
        <p className="wk-side-lead">
          Questions are optional. Add some when you want to know something before people choose a time.
        </p>
      );
    }
    return (
      <div>
        {lane.questionInsights.length > 0 ? (
          <>
            <p className="wk-side-eyebrow">Which answers send people elsewhere</p>
            <div className="fl-insights">
              {lane.questionInsights.map((q) => (
                <div key={q.questionId} className="fl-insight">
                  <p>{q.prompt}</p>
                  <small>
                    {q.sentElsewhere} of {q.answered}
                    {q.routingAnswers[0] ? ` · mostly “${q.routingAnswers[0].answer}”` : ''}
                  </small>
                  <div className="insight-bar" aria-hidden="true">
                    <div className="insight-bar-fill" style={{ width: `${share(q.sentElsewhere, q.answered)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="wk-side-hint">
              One person can be sent elsewhere by more than one question, so these do not add up.
            </p>
          </>
        ) : (
          <p className="wk-side-lead">No answer has sent anyone elsewhere in the last 30 days.</p>
        )}
        {model.elsewhere.said && (
          <p className="wk-side-hint">
            People sent elsewhere see your next-steps message
            {model.elsewhere.label ? `, with a link: “${model.elsewhere.label}”` : ''}. It is the same for every
            service. <a href={a(`sessions/${lane.id}?tab=questions`)}>Change what they’re told</a>
          </p>
        )}
      </div>
    );
  }

  if (id === 'times') {
    return (
      <div>
        <p className="wk-side-lead">
          Your hours are shared by every service.{' '}
          {data.calendarStatus === 'active'
            ? 'Your calendar is connected: busy times there close your hours here, and bookings are added to it.'
            : data.calendarStatus === 'not_connected'
              ? 'No calendar is connected, so only the hours you set here decide what is free.'
              : 'Your calendar needs reconnecting. Until it is, busy times there are not seen here.'}
        </p>
        {data.syncFailures > 0 && (
          <p className="wk-warning">
            {data.syncFailures === 1 ? '1 booking is' : `${data.syncFailures} bookings are`} not in your Google
            Calendar. They are outlined in red on Your calendar.
          </p>
        )}
        <div className="wk-actions">
          <a className="btn-secondary" href={a('week')}>
            Open your calendar
          </a>
          {data.calendarStatus !== 'active' && <a href={a('week#calendar')}>Connect Google or Outlook</a>}
        </div>
      </div>
    );
  }

  const next = data.nextUp.filter((b) => b.eventTypeId === lane.id).slice(0, 5);
  const said = readout(model, lane);
  return (
    <div>
      <p className="wk-side-lead">{said.text}</p>
      {said.asides.map((line) => (
        <p key={line} className="wk-side-hint">
          {line}
        </p>
      ))}
      <p className="wk-side-eyebrow" style={{ marginTop: 14 }}>
        Coming up
      </p>
      {next.length === 0 ? (
        <p className="wk-side-lead">Nothing coming up for {lane.name}.</p>
      ) : (
        <ul className="fl-next">
          {next.map((b) => (
            <li key={b.id}>
              <a href={a(`people?person=${encodeURIComponent(b.email)}`)}>{b.name}</a>
              <small>{DateTime.fromISO(b.startsAt).setZone(data.timezone).toFormat('ccc d LLL, HH:mm')}</small>
            </li>
          ))}
        </ul>
      )}
      <div className="wk-actions">
        <a className="btn-secondary" href={a('week')}>
          Open your calendar
        </a>
        <a href={a('messages')}>What they’re told</a>
      </div>
    </div>
  );
}

function FindDetail({ slug, model, lane }: { slug: string; model: FlowModel; lane: Lane }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => setUrl(`${window.location.origin}/${slug}`), [slug]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  return (
    <div>
      <p className="wk-side-eyebrow">Your booking page</p>
      <code className="pp-link">{url || `/${slug}`}</code>
      <div className="wk-actions" style={{ marginTop: 10 }}>
        <button type="button" className="btn-secondary" onClick={() => void copy()} disabled={!url}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <a href={url || `/${slug}`} target="_blank" rel="noreferrer">
          Open it
        </a>
      </div>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Booking page link copied' : ''}
      </span>
      <p className="wk-side-hint">
        One page for every service: people choose which one first. In the last 30 days {model.page.arrived} new{' '}
        {model.page.arrived === 1 ? 'person' : 'people'} started on it
        {model.page.returning > 0 ? `, and ${model.page.returning} who already knew you` : ''}.{' '}
        {model.page.returning > 0 && <a href={`/admin/${slug}/people?figure=returning`}>See who</a>}
      </p>
      {lane.fromClients && (
        <p className="wk-side-hint">
          {model.clients.count} {model.clients.count === 1 ? 'person has' : 'people have'} their own link, which skips
          the questions. <a href={`/admin/${slug}/people`}>See them in People</a>
        </p>
      )}
      <p className="wk-side-hint">
        <a href={`/admin/${slug}/share?service=${encodeURIComponent(lane.id)}`}>
          Share {lane.name} on its own, or put it on your website
        </a>
      </p>
    </div>
  );
}

/* ── Trying the page ────────────────────────────────────────────────────── */

/**
 * The real booking page, in a test run, beside the steps.
 *
 * The same page a client gets, not a copy: in a test run it saves nothing,
 * holds no time and sends nothing (see src/lib/test-run.ts), and tells the
 * flow each step it reaches, so the steps light up as it is walked.
 */
function TryPanel({ slug, onRestart }: { slug: string; onRestart: () => void }) {
  const [run, setRun] = useState(0);
  return (
    <aside className="fl-try" aria-label="Your booking page, as a test">
      <div className="fl-try-head">
        {/* The page itself says it is a test, in its own banner; said once
            there rather than twice here. */}
        <p>
          <b>Your booking page</b>, as a client sees it
        </p>
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            setRun((n) => n + 1);
            onRestart();
          }}
        >
          Start again
        </button>
      </div>
      <iframe key={run} className="fl-try-frame" src={`/t/${encodeURIComponent(slug)}?test=1`} title="Your booking page, test run" />
    </aside>
  );
}

function TryLegend({ walked, lane }: { walked: Walked; lane: Lane }) {
  const where: Record<StepId, string> = {
    find: 'On your page, choosing a service.',
    questions: walked.elsewhere ? 'Sent elsewhere: this is the message they would see.' : 'Answering the questions.',
    times: 'Choosing a time, and giving their details.',
    booked: 'Booked. In a test run, nothing was.',
  };
  return (
    <p className="fl-try-status" aria-live="polite">
      <span className="fl-try-dot" aria-hidden="true" />
      {where[walked.current ?? 'find']}
      <span className="fc-try-svc"> · {lane.name}</span>
    </p>
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
