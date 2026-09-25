'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import { share } from '@/lib/enquiry-analysis';
import { ServiceBadge } from '@/components/admin/ServiceBadge';
import { EmbedSites } from '@/components/admin/EmbedSites';
import { Dial, Grille, Lamp } from '@/components/admin/Instruments';
import {
  asksQuestions,
  buildFlow,
  laneState,
  readout,
  serviceSteps,
  stepForPart,
  type FlowInput,
  type FlowModel,
  type FlowStep,
  type Lane,
  type StepId,
} from '@/lib/flow';
import { partForPhase, type TestMessage } from '@/lib/test-run';
import { LIMIT_REACHED, nameConfirmed, SERVICE_LIMIT, withinServiceLimit } from '@/lib/service-deletion';

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
export default function FlowPage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearchParams();

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
      if (!msg || msg.type !== 'intro:test') return;
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
                <a className="btn-secondary" href={a(`sessions/${lane.id}`)}>
                  Service settings
                </a>
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

  return (
    <>
      <PageHeader
        eyebrow="Flow"
        title="Your services"
        description="Choose a service to configure it."
        actions={
          model && !trying ? (
            <button type="button" className="btn-primary btn-add" onClick={() => setAdding(true)}>
              <span className="btn-add-plus" aria-hidden="true">
                +
              </span>
              Add a service
            </button>
          ) : undefined
        }
      />

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
              {adding && <AddService slug={slug} activeCount={activeCount} onCancel={() => setAdding(false)} />}

              {model.lanes.length === 0 ? (
                <p className="fc-empty">No services yet. Add your first one to see how people book it.</p>
              ) : (
                <ul className="fc-rows">
                  {model.lanes.map((l) => {
                    const state = laneState(model, l);
                    const isOpen = lane?.id === l.id;
                    return (
                      <li key={l.id}>
                        <button
                          type="button"
                          className={`fc-row${isOpen ? ' is-open' : ''}`}
                          aria-expanded={isOpen}
                          aria-controls="fc-flow"
                          onClick={() => chooseLane(l.id)}
                          disabled={trying && !isOpen}
                        >
                          <ServiceBadge name={l.name} off={!state.live} />
                          <span className="fc-row-name">
                            <b>{l.name}</b>
                            <small>{l.words}</small>
                          </span>
                          {state.live && (
                            <span className="fc-row-figs">
                              {l.bookedPeople} booked
                              {l.fromPage && asksQuestions(l) ? ` · ${l.qualified} could book` : ''}
                            </span>
                          )}
                          <span className={`fc-state${state.live ? '' : ' is-off'}`}>
                            <Lamp tone={state.live ? 'live' : 'need'} />
                            {state.label}
                          </span>
                          {/* A knob that turns: filled while its flow is open. */}
                          <span className="fc-row-toggle" aria-hidden="true">
                            {isOpen ? '▴' : '▾'}
                          </span>
                        </button>
                        {isOpen && renderFlow(model, l, data)}
                      </li>
                    );
                  })}
                </ul>
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

interface DeletionCheck {
  upcoming: number;
  owedSessions: number;
  past: number;
  blockers: string[];
  keeps: string;
}

/**
 * Deleting for good, asked twice: first what it means — or why it cannot
 * happen yet — then the service's name, typed back. The route checks every
 * one of these again before it deletes anything.
 */
function DeleteService({
  slug,
  id,
  name,
  onCancel,
  onDeleted,
}: {
  slug: string;
  id: string;
  name: string;
  onCancel: () => void;
  onDeleted: (note: string) => void;
}) {
  const [check, setCheck] = useState<DeletionCheck | null>(null);
  const [stage, setStage] = useState<'explain' | 'type'>('explain');
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetchJson<DeletionCheck>(`/api/admin/${slug}/event-types/${id}/deletion`)
      .then(setCheck)
      .catch((cause) => setError((cause as Error).message));
  }, [slug, id]);

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ emailedTo: string | null; email: string }>(
        `/api/admin/${slug}/event-types/${id}`,
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirmName: typed }),
        },
      );
      onDeleted(
        result.email === 'sent' && result.emailedTo
          ? `${name} was deleted. A confirmation is on its way to ${result.emailedTo}.`
          : `${name} was deleted.`,
      );
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="fc-delete" role="region" aria-label={`Delete ${name}`}>
      {!check && !error && <p className="fc-hint">Checking what is still booked…</p>}

      {check && check.blockers.length > 0 && (
        <>
          <p>
            <b>{name} can’t be deleted yet.</b>
          </p>
          <ul className="fc-delete-reasons">
            {check.blockers.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <div className="fl-actions">
            {check.upcoming > 0 && (
              <a className="btn-secondary" href={`/admin/${slug}/week?view=list`}>
                See them on the Week
              </a>
            )}
            {check.owedSessions > 0 && (
              <a className="btn-secondary" href={`/admin/${slug}/people?show=owed`}>
                See who in People
              </a>
            )}
            <button type="button" className="btn-link" onClick={onCancel}>
              Close
            </button>
          </div>
        </>
      )}

      {check && check.blockers.length === 0 && stage === 'explain' && (
        <>
          <p>
            <b>Delete {name} for good?</b> It can’t be undone: it can never be resumed, and its settings and its
            own questions are removed. {check.keeps} Nobody is cancelled or emailed. You’ll get an email confirming
            it.
          </p>
          <div className="fl-actions">
            <button type="button" className="btn-secondary" onClick={() => setStage('type')}>
              Continue
            </button>
            <button type="button" className="btn-link" onClick={onCancel}>
              Keep it
            </button>
          </div>
        </>
      )}

      {check && check.blockers.length === 0 && stage === 'type' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nameConfirmed(typed, name)) void remove();
          }}
        >
          <div className="field">
            <label htmlFor={`fc-delete-${id}`}>
              To confirm, type the service’s name: <b>{name}</b>
            </label>
            <input
              id={`fc-delete-${id}`}
              type="text"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          <div className="fl-actions">
            <button type="submit" className="btn-danger" disabled={saving || !nameConfirmed(typed, name)}>
              {saving ? 'Deleting…' : 'Delete for good'}
            </button>
            <button type="button" className="btn-link" onClick={onCancel} disabled={saving}>
              Keep it
            </button>
          </div>
        </form>
      )}

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
            service. <a href={a('messages?m=next_steps')}>Change what they’re told</a>
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
            ? 'Google Calendar is connected: busy times there close your hours here, and bookings are added to it.'
            : data.calendarStatus === 'not_connected'
              ? 'Google Calendar is not connected, so only the hours you set here decide what is free.'
              : 'Google Calendar needs reconnecting. Until it is, busy times there are not seen here.'}
        </p>
        {data.syncFailures > 0 && (
          <p className="wk-warning">
            {data.syncFailures === 1 ? '1 booking is' : `${data.syncFailures} bookings are`} not in your Google
            Calendar. They are outlined in red on the Week.
          </p>
        )}
        <div className="wk-actions">
          <a className="btn-secondary" href={a('week')}>
            Open the Week
          </a>
          {data.calendarStatus !== 'active' && <a href={a('week#calendar')}>Connect Google Calendar</a>}
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
          Open the Week
        </a>
        <a href={a('messages')}>What they’re told</a>
      </div>
    </div>
  );
}

function FindDetail({ slug, model, lane }: { slug: string; model: FlowModel; lane: Lane }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => setUrl(`${window.location.origin}/t/${slug}`), [slug]);

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
      <code className="pp-link">{url || `/t/${slug}`}</code>
      <div className="wk-actions" style={{ marginTop: 10 }}>
        <button type="button" className="btn-secondary" onClick={() => void copy()} disabled={!url}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <a href={url || `/t/${slug}`} target="_blank" rel="noreferrer">
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
      <details className="fl-embed">
        <summary>Put it on your own website</summary>
        <EmbedSites slug={slug} />
      </details>
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
function AddService({ slug, activeCount, onCancel }: { slug: string; activeCount: number; onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atCap = !withinServiceLimit(activeCount);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ eventType: { id: string } }>(`/api/admin/${slug}/event-types`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      router.push(`/admin/${slug}/sessions/${result.eventType.id}`);
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div className="admin-card-title">
        A new service · {activeCount} of {SERVICE_LIMIT} in use
      </div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {atCap ? (
        <p className="notice notice-muted" style={{ margin: 0 }}>
          {LIMIT_REACHED}
        </p>
      ) : (
        <div className="fl-add">
          <div className="field">
            <label htmlFor="fl-new-name">What is it called?</label>
            <input
              id="fl-new-name"
              type="text"
              placeholder="e.g. Website design"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={saving || !name.trim()}>
            {saving ? 'Adding…' : 'Add and set up'}
          </button>
          <button type="button" className="btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
      {atCap && (
        <button type="button" className="btn-link" onClick={onCancel} style={{ marginTop: 8 }}>
          Close
        </button>
      )}
    </form>
  );
}
