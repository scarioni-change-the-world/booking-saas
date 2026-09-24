'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import { share } from '@/lib/enquiry-analysis';
import { ServiceBadge } from '@/components/admin/ServiceBadge';
import { EmbedSites } from '@/components/admin/EmbedSites';
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

/** Up to this many active services — the same soft guide Services kept. */
const SOFT_CAP = 5;

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
 * is a button beside the title. Choosing a service opens its flow in its
 * own card underneath, like a drop-down: four
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

  return (
    <>
      <PageHeader
        eyebrow="Flow"
        title="Your services"
        description="Choose a service to configure it."
        actions={
          model ? (
            trying ? (
              <button type="button" className="btn-secondary" onClick={() => setTrying(false)}>
                Stop the test
              </button>
            ) : (
              <div className="fl-actions">
                <button type="button" className="btn-secondary" onClick={() => setAdding(true)}>
                  + Add a service
                </button>
                {model.lanes.length > 0 && (
                  <button type="button" className="btn-primary" onClick={startTrying}>
                    Try your booking page
                  </button>
                )}
              </div>
            )
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
                          style={{ ['--svc' as string]: l.color }}
                          onClick={() => chooseLane(l.id)}
                          disabled={trying && !isOpen}
                        >
                          <ServiceBadge name={l.name} color={l.color} />
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
                          <span className={`fc-state${state.live ? '' : ' is-off'}`}>{state.label}</span>
                          <span className="fc-row-toggle" aria-hidden="true">
                            {isOpen ? 'Hide flow ▴' : 'Show flow ▾'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {lane && (
              <section
                id="fc-flow"
                className="fc-card fc-flow"
                style={{ ['--svc' as string]: lane.color }}
                aria-labelledby="fc-flow-title"
              >
                <div className="fc-card-head">
                  <div className="fc-flow-title">
                    <ServiceBadge name={lane.name} color={lane.color} size="lg" />
                    <div>
                      <p className="fc-eyebrow">How people book it · last 30 days</p>
                      <h2 id="fc-flow-title">{lane.name}</h2>
                    </div>
                  </div>
                  {!trying && (
                    <a className="btn-secondary" href={a(`sessions/${lane.id}`)}>
                      Service settings
                    </a>
                  )}
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
                        {st.figure ? (
                          <>
                            <b className="fc-value">{st.figure.value}</b>
                            <span className="fc-caption">
                              {st.figure.label}
                              {st.figure.sub ? ` · ${st.figure.sub}` : ''}
                            </span>
                          </>
                        ) : (
                          <span className="fc-short">{st.short}</span>
                        )}
                        {st.flag && <span className="fc-flag">{st.flag}</span>}
                        {trying && walked.current === st.id && (
                          <span className="fc-flag">{walked.elsewhere && st.id === 'questions' ? 'Sent elsewhere' : 'The test is here'}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ol>

                {!trying && !opened && <p className="fc-hint">Choose a step to see more, or to change it.</p>}

                {trying && <TryLegend walked={walked} lane={lane} />}

                {!trying && opened && (
                  <StepPanel step={opened} slug={slug} onClose={() => setOpenStep(null)}>
                    <StepDetail id={opened.id} model={model} lane={lane} data={data} slug={slug} />
                  </StepPanel>
                )}
              </section>
            )}

            {!trying && model.archived.length > 0 && (
              <p className="fl-archived">
                Archived:{' '}
                {model.archived.map((x, i) => (
                  <span key={x.id}>
                    {i > 0 && ', '}
                    <a href={a(`sessions/${x.id}`)}>{x.name}</a>
                  </span>
                ))}
              </p>
            )}
          </div>

          {trying && <TryPanel slug={slug} onRestart={() => setWalked(START)} />}
        </div>
      )}
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
  const atCap = activeCount >= SOFT_CAP;

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
        A new service · {activeCount} of {SOFT_CAP} used
      </div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {atCap ? (
        <p className="notice notice-muted" style={{ margin: 0 }}>
          You&apos;re using all {SOFT_CAP} services available right now. Archive one to make room for another.
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
