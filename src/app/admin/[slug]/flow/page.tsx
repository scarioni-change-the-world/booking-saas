'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import { share } from '@/lib/enquiry-analysis';
import { ServiceBadge } from '@/components/admin/ServiceBadge';
import {
  asksQuestions,
  bookedByNew,
  buildFlow,
  describeLane,
  drawServiceFlow,
  type DrawnNode,
  type FlowInput,
  type FlowModel,
  type Lane,
  type PartId,
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
  thisWeekCount: number;
  nextUp: NextUp[];
}

/** Up to this many active services — the same soft guide Services kept. */
const SOFT_CAP = 5;

/** Which two parts each line joins, so a walked route can light its lines. */
const EDGE_ENDS: Record<string, [string, string]> = {
  'page-service': ['page', 'service'],
  'service-questions': ['service', 'questions'],
  'questions-elsewhere': ['questions', 'elsewhere'],
  'questions-calendar': ['questions', 'calendar'],
  'calendar-booked': ['calendar', 'booked'],
};

export default function FlowPage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearchParams();

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Seeded from the address, so a link elsewhere can open a service or a
     part of it: ?service=<id>, or ?part=service:<id> from a service's page. */
  const seededPart = search.get('part');
  const [laneId, setLaneId] = useState<string | null>(
    () => search.get('service') ?? (seededPart?.startsWith('service:') ? seededPart.slice(8) : null),
  );
  const [selected, setSelected] = useState<PartId | null>(() => (seededPart as PartId | null) ?? null);
  const [view, setView] = useState<'diagram' | 'list'>(search.get('view') === 'list' ? 'list' : 'diagram');
  const [adding, setAdding] = useState(false);
  const [trying, setTrying] = useState(false);
  const [walked, setWalked] = useState<{ parts: Set<string>; current: string | null }>({
    parts: new Set(),
    current: null,
  });
  const sideRef = useRef<HTMLElement>(null);

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
  const lane = model?.lanes.find((l) => l.id === laneId) ?? model?.lanes[0] ?? null;
  const drawing = useMemo(() => (model && lane ? drawServiceFlow(model, lane, slug) : null), [model, lane, slug]);

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
      setWalked((prev) => {
        const parts = msg.phase === 'service' || msg.phase === 'loading' ? new Set<string>() : new Set(prev.parts);
        parts.add('page');
        if (msg.eventTypeId) parts.add('service');
        if (part) parts.add(part);
        /* A service that asks nothing still passes the questions' place on
           the way to the calendar; lighting it keeps the route unbroken. */
        if ((part === 'calendar' || part === 'booked') && chosen && !asksQuestions(chosen)) parts.add('questions');
        if (part === 'booked') parts.add('calendar');
        return { parts, current: part ?? (msg.eventTypeId ? 'service' : 'page') };
      });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [trying, model]);

  function open(part: PartId) {
    if (trying) return;
    setSelected((current) => (current === part ? null : part));
    /* On a narrow screen the panel is below the flow; bring it to where
       the person is looking, rather than leave them to find it. */
    if (typeof window !== 'undefined' && window.innerWidth < 1080) {
      requestAnimationFrame(() => sideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  function chooseLane(id: string) {
    setLaneId(id);
    // A part opened for one service means nothing for another.
    setSelected((current) => (current && current.startsWith('service:') ? `service:${id}` : current));
  }

  function startTrying() {
    setSelected(null);
    setWalked({ parts: new Set(['page']), current: 'page' });
    setTrying(true);
  }

  const activeCount = data?.services.filter((s) => s.active).length ?? 0;
  const litKey = (part: PartId) => (part.startsWith('service:') ? 'service' : part);

  return (
    <>
      <PageHeader
        eyebrow="Flow"
        title="How people reach you"
        description="Each service's path from your booking page to your calendar, in the order people take it. The numbers are the last 30 days. Choose any part to open it here."
        actions={
          <div className="fl-actions">
            {!trying && (
              <div className="wk-view-switch" role="group" aria-label="Show as">
                <button type="button" className="filter-chip" aria-pressed={view === 'diagram'} onClick={() => setView('diagram')}>
                  Diagram
                </button>
                <button type="button" className="filter-chip" aria-pressed={view === 'list'} onClick={() => setView('list')}>
                  List
                </button>
              </div>
            )}
            {model && model.lanes.length > 0 && (
              trying ? (
                <button type="button" className="btn-secondary" onClick={() => setTrying(false)}>
                  Stop the test
                </button>
              ) : (
                <button type="button" className="btn-primary" onClick={startTrying}>
                  Try your booking page
                </button>
              )
            )}
          </div>
        }
      />

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="status">Loading…</p>}

      {data && model && (
        <>
          <ServiceSwitcher
            model={model}
            current={lane}
            onChoose={chooseLane}
            onAdd={() => setAdding(true)}
            disabled={trying}
          />

          {adding && <AddService slug={slug} activeCount={activeCount} onCancel={() => setAdding(false)} />}

          {!lane ? (
            <p className="notice notice-muted">
              No services yet. Add your first one and it appears here with its own flow.
            </p>
          ) : (
            <div className={trying ? 'fl-try-layout' : 'wk-layout'}>
              <div className="fl-main">
                <div className={`fl-diagram${view === 'list' && !trying ? ' is-hidden' : ''}`}>
                  <svg
                    className="fl-svg"
                    viewBox={`0 0 ${drawing!.width} ${drawing!.height}`}
                    role="group"
                    aria-label={describeLane(model, lane)}
                  >
                    {drawing!.edges.map((e) => {
                      const ends = EDGE_ENDS[e.id];
                      const lit = trying && ends && walked.parts.has(ends[0]) && walked.parts.has(ends[1]);
                      return (
                        <g key={e.id} className={lit ? 'is-lit' : undefined}>
                          <path
                            className={`fl-edge tone-${e.tone}`}
                            d={e.d}
                            style={e.color ? { stroke: e.color } : undefined}
                          />
                          {e.label && (
                            <text className={`fl-count tone-${e.tone}`} x={e.lx} y={e.ly} textAnchor={e.anchor}>
                              {e.label}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {drawing!.nodes.map((n) => (
                      <Node
                        key={n.part}
                        node={n}
                        selected={selected === n.part}
                        lit={trying && walked.parts.has(litKey(n.part))}
                        here={trying && walked.current === litKey(n.part)}
                        onOpen={() => open(n.part)}
                      />
                    ))}
                  </svg>
                </div>

                {!trying && (
                  <FlowList
                    model={model}
                    lane={lane}
                    selected={selected}
                    onOpen={open}
                    className={view === 'list' ? 'fl-list is-shown' : 'fl-list'}
                  />
                )}

                {trying && <TryLegend walked={walked} lane={lane} />}

                {!trying && model.archived.length > 0 && (
                  <p className="fl-archived">
                    Archived, and not in the flow:{' '}
                    {model.archived.map((a, i) => (
                      <span key={a.id}>
                        {i > 0 && ', '}
                        <a href={`/admin/${slug}/sessions/${a.id}`}>{a.name}</a>
                      </span>
                    ))}
                  </p>
                )}
              </div>

              {trying ? (
                <TryPanel slug={slug} onRestart={() => setWalked({ parts: new Set(['page']), current: 'page' })} />
              ) : (
                <aside className="wk-side" aria-live="polite" ref={sideRef}>
                  {selected ? (
                    <Panel
                      key={`${selected}-${lane.id}`}
                      part={selected}
                      slug={slug}
                      data={data}
                      model={model}
                      lane={lane}
                      onClose={() => setSelected(null)}
                    />
                  ) : (
                    <Summary model={model} lane={lane} data={data} />
                  )}
                </aside>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ── Choosing a service ─────────────────────────────────────────────────── */

/**
 * One card per service, each with its headline number, so the comparison
 * across services is on screen while one of them is drawn. A service that
 * is not connected yet shows a dashed card, the same as its flow.
 */
function ServiceSwitcher({
  model,
  current,
  onChoose,
  onAdd,
  disabled,
}: {
  model: FlowModel;
  current: Lane | null;
  onChoose: (id: string) => void;
  onAdd: () => void;
  disabled: boolean;
}) {
  return (
    <div className="fl-services" role="tablist" aria-label="Services">
      {model.lanes.map((l) => (
        <button
          key={l.id}
          type="button"
          role="tab"
          aria-selected={current?.id === l.id}
          className={`fl-service${l.live ? '' : ' is-broken'}`}
          style={{ borderTopColor: l.color }}
          onClick={() => onChoose(l.id)}
          disabled={disabled && current?.id !== l.id}
        >
          <ServiceBadge name={l.name} color={l.color} />
          <span>
            <b>{l.name}</b>
            <small>
              {l.fromPage || l.fromClients
                ? `${l.booked} booked · ${l.fromPage && asksQuestions(l) ? `${l.qualified} let through` : 'no questions'}`
                : 'Not connected yet'}
            </small>
          </span>
        </button>
      ))}
      {!disabled && (
        <button type="button" className="fl-service is-add" onClick={onAdd}>
          <span aria-hidden="true" className="fl-add-mark">
            +
          </span>
          <span>
            <b>Add a service</b>
            <small>It arrives with its own flow</small>
          </span>
        </button>
      )}
    </div>
  );
}

/* ── The diagram's parts ────────────────────────────────────────────────── */

function Node({
  node,
  selected,
  lit,
  here,
  onOpen,
}: {
  node: DrawnNode;
  selected: boolean;
  lit: boolean;
  here: boolean;
  onOpen: () => void;
}) {
  const clipId = `clip-${node.part.replace(/[^a-z0-9-]/gi, '')}`;
  return (
    <g
      className={`fl-node tone-${node.tone}${selected ? ' is-selected' : ''}${lit ? ' is-lit' : ''}${here ? ' is-here' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${node.title}: ${node.sub}${node.flag ? `. ${node.flag}` : ''}${here ? '. The test is here' : ''}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={9} />
      {node.color && node.monogram ? (
        /* The service: its colour down the left edge and its mark. */
        <>
          <clipPath id={clipId}>
            <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={9} />
          </clipPath>
          <rect x={node.x} y={node.y} width={8} height={node.h} clipPath={`url(#${clipId})`} style={{ fill: node.color }} />
          <circle cx={node.x + 30} cy={node.y + node.h / 2} r={15} style={{ fill: node.color }} />
          <text className="fl-mark" x={node.x + 30} y={node.y + node.h / 2 + 4.5} textAnchor="middle">
            {node.monogram}
          </text>
          <text className="fl-title is-service" x={node.x + 54} y={node.y + node.h / 2 - 3}>
            {clip(node.title, node.w - 50, 7.6)}
          </text>
          <text className="fl-sub" x={node.x + 54} y={node.y + node.h / 2 + 14}>
            {clip(node.sub, node.w - 50)}
          </text>
        </>
      ) : (
        <>
          <text className="fl-title" x={node.x + node.w / 2} y={node.y + node.h / 2 - 3} textAnchor="middle">
            {clip(node.title, node.w)}
          </text>
          <text className="fl-sub" x={node.x + node.w / 2} y={node.y + node.h / 2 + 14} textAnchor="middle">
            {clip(node.sub, node.w)}
          </text>
        </>
      )}
      {here && (
        <text className="fl-here" x={node.x + node.w / 2} y={node.y + node.h + 16} textAnchor="middle">
          You are here
        </text>
      )}
      {node.flag && (
        <circle className="fl-flag" cx={node.x + node.w - 4} cy={node.y + 4} r={6}>
          <title>{node.flag}</title>
        </circle>
      )}
    </g>
  );
}

/** SVG text does not wrap; a long name is shortened, never overflowed. */
function clip(text: string, width: number, charWidth = 7): string {
  const max = Math.floor((width - 16) / charWidth);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ── The same flow, as a list ───────────────────────────────────────────── */

function FlowList({
  model,
  lane,
  selected,
  onOpen,
  className,
}: {
  model: FlowModel;
  lane: Lane;
  selected: PartId | null;
  onOpen: (part: PartId) => void;
  className: string;
}) {
  const asks = asksQuestions(lane);
  const item = (
    part: PartId,
    title: string,
    detail: string,
    tone = '',
    flag: string | null = null,
    service?: { color: string },
  ) => (
    <button
      type="button"
      className={`fl-item ${tone}${service ? ' is-service' : ''}`}
      aria-pressed={selected === part}
      onClick={() => onOpen(part)}
      style={service ? { borderLeftColor: service.color } : undefined}
    >
      <b>
        {service && <ServiceBadge name={title} color={service.color} size="sm" />}
        {title}
      </b>
      <span>{detail}</span>
      {flag && <span className="fl-item-flag">{flag}</span>}
    </button>
  );

  return (
    <ol className={className} aria-label={`${lane.name}, step by step`}>
      <li>{item('page', 'Your page', 'Where new people choose a service', 'is-door')}</li>
      <li>
        {item(
          lane.part,
          lane.name,
          lane.fromPage || lane.fromClients ? lane.sub : 'Not connected: offered to nobody',
          lane.live ? '' : 'is-broken',
          null,
          { color: lane.color },
        )}
      </li>
      <li>
        {item(
          'questions',
          'Questions',
          !lane.fromPage
            ? 'Not offered to new enquiries'
            : asks
              ? `${lane.sharedQuestions + lane.ownQuestions} asked · ${lane.finished} of ${lane.started} finished · ${lane.qualified} let through`
              : 'Nothing asked: new people go straight to the calendar',
        )}
        {asks && lane.fromPage && (
          <ol>
            <li>
              {item(
                'elsewhere',
                'Elsewhere',
                `${lane.sentElsewhere} sent to another next step`,
                'is-exit',
                model.elsewhere.said ? null : 'Nothing written for them',
              )}
            </li>
          </ol>
        )}
      </li>
      <li>
        {item(
          'clients',
          'Existing clients',
          lane.fromClients
            ? `${lane.bookedByClients} booked on their own link, without the questions`
            : 'Not offered to existing clients',
          'is-door',
        )}
      </li>
      <li>
        {item(
          'calendar',
          'Calendar',
          model.calendar.noHours
            ? 'No opening hours, so nothing can be booked'
            : `${Math.round(model.calendar.weeklyMinutes / 6) / 10} h open a week, shared by every service`,
          model.calendar.noHours ? 'is-broken' : '',
          model.calendar.flag,
        )}
      </li>
      <li>{item('booked', 'Booked', `${lane.booked} in the last 30 days`, 'is-end', model.booked.flag)}</li>
    </ol>
  );
}

/* ── With nothing chosen ────────────────────────────────────────────────── */

function Summary({ model, lane, data }: { model: FlowModel; lane: Lane; data: Payload }) {
  return (
    <div>
      <p className="wk-side-eyebrow svc-line">
        <ServiceBadge name={lane.name} color={lane.color} size="sm" />
        {lane.name} · last 30 days
      </p>
      <dl className="wk-facts">
        <div>
          <dt>Started its questions</dt>
          <dd>{lane.fromPage && asksQuestions(lane) ? lane.started : '—'}</dd>
        </div>
        <div>
          <dt>Booked</dt>
          <dd>{lane.booked}</dd>
        </div>
        <div>
          <dt>Sent elsewhere</dt>
          <dd>{lane.fromPage && asksQuestions(lane) ? lane.sentElsewhere : '—'}</dd>
        </div>
        <div>
          <dt>All services, this week</dt>
          <dd>{data.thisWeekCount}</dd>
        </div>
      </dl>
      {model.calendar.noHours && (
        <p className="wk-warning">No opening hours are set, so nothing can be booked. Open Calendar to set them.</p>
      )}
      {!lane.live && (
        <p className="wk-warning">
          {lane.name} is not connected yet. Its gaps are drawn as broken lines; open it to see what joins them.
        </p>
      )}
      <p className="wk-side-hint">
        Choose any part of the flow to see it here. To walk it the way a client does, use Try your booking
        page.
      </p>
    </div>
  );
}

/* ── One part, opened ───────────────────────────────────────────────────── */

function Panel({
  part,
  slug,
  data,
  model,
  lane,
  onClose,
}: {
  part: PartId;
  slug: string;
  data: Payload;
  model: FlowModel;
  lane: Lane;
  onClose: () => void;
}) {
  const a = (path: string) => `/admin/${slug}/${path}`;
  const head = (title: string, eyebrow: string) => (
    <>
      <p className="wk-side-eyebrow">{eyebrow}</p>
      <div className="wk-side-head">
        <h3>{title}</h3>
        <button type="button" className="btn-link" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
  const asks = asksQuestions(lane);

  if (part === 'page') return <PagePanel slug={slug} model={model} head={head('Your page', 'The way in for new people')} />;

  if (part === 'questions') {
    return (
      <div>
        {head('Questions', `Asked before ${lane.name}`)}
        {!lane.fromPage ? (
          <p className="wk-side-lead">
            {lane.name} is not offered to new enquiries, so nobody is asked anything for it.
          </p>
        ) : !asks ? (
          <p className="wk-side-lead">Nothing is asked. New people choosing {lane.name} go straight to the calendar.</p>
        ) : (
          <>
            <p className="wk-side-lead">
              {lane.sharedQuestions} asked for every service
              {lane.ownQuestions > 0 ? `, and ${lane.ownQuestions} of its own` : ', and none of its own'}.
            </p>
            <dl className="wk-facts">
              <div>
                <dt>Finished</dt>
                <dd>
                  {lane.finished} of {lane.started}
                </dd>
              </div>
              <div>
                <dt>Let through</dt>
                <dd>{lane.qualified}</dd>
              </div>
            </dl>
            {lane.questionInsights.length > 0 && (
              <>
                <p className="wk-side-eyebrow" style={{ marginTop: 14 }}>
                  Where people are turned away
                </p>
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
                  One person can be turned away by more than one question, so these do not add up.
                </p>
              </>
            )}
          </>
        )}
        <div className="wk-actions">
          <a className="btn-secondary" href={a(`screening?service=${encodeURIComponent(lane.id)}`)}>
            Change its questions
          </a>
          {lane.started > lane.finished && <a href={a('people?show=unfinished')}>Who didn’t finish</a>}
        </div>
      </div>
    );
  }

  if (part === 'elsewhere') {
    return (
      <div>
        {head('Elsewhere', 'Where an answer sends people instead')}
        <dl className="wk-facts">
          <div>
            <dt>From {lane.name}</dt>
            <dd>{lane.sentElsewhere}</dd>
          </div>
          <div>
            <dt>All services</dt>
            <dd>{model.elsewhere.count}</dd>
          </div>
        </dl>
        {model.elsewhere.said ? (
          <p className="wk-side-lead">
            They are shown your next-steps message
            {model.elsewhere.label ? `, with a link: “${model.elsewhere.label}”` : ''}. It is the same for
            every service.
          </p>
        ) : (
          <p className="wk-warning">
            Nothing is written for them. They are told a meeting is not the next step, and nothing else.
          </p>
        )}
        <div className="wk-actions">
          <a className="btn-secondary" href={a('messages?m=next_steps')}>
            {model.elsewhere.said ? 'Change what they’re told' : 'Write it'}
          </a>
          {model.elsewhere.count > 0 && <a href={a('people?figure=other')}>See who</a>}
        </div>
      </div>
    );
  }

  if (part === 'clients') {
    return (
      <div>
        {head('Existing clients', 'The way in for people you know')}
        <p className="wk-side-lead">
          Everyone who books gets their own link. It skips your questions and offers only the services you
          have marked for existing clients.
        </p>
        <dl className="wk-facts">
          <div>
            <dt>With their own link</dt>
            <dd>{model.clients.count}</dd>
          </div>
          <div>
            <dt>Booked {lane.name}</dt>
            <dd>{lane.bookedByClients}</dd>
          </div>
        </dl>
        {!lane.fromClients && (
          <p className="wk-warning">
            {lane.name} is not offered to existing clients, so it does not appear on their link.
          </p>
        )}
        <div className="wk-actions">
          <a className="btn-secondary" href={a(`sessions/${lane.id}`)}>
            Who {lane.name} is offered to
          </a>
          <a href={a('people')}>See them in People</a>
        </div>
      </div>
    );
  }

  if (part === 'calendar') {
    return (
      <div>
        {head('Calendar', 'When people can book — shared by every service')}
        {model.calendar.noHours ? (
          <p className="wk-warning">No opening hours are set, so nothing can be booked, whatever else is ready.</p>
        ) : (
          <dl className="wk-facts">
            <div>
              <dt>Usual open hours</dt>
              <dd>{Math.round(model.calendar.weeklyMinutes / 6) / 10} h a week</dd>
            </div>
          </dl>
        )}
        <p className="wk-side-lead">
          {data.calendarStatus === 'active'
            ? 'Google Calendar is connected: busy times there close your hours here, and bookings are added to it.'
            : data.calendarStatus === 'not_connected'
              ? 'Google Calendar is not connected. Only the hours you set here decide what is free.'
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
            {model.calendar.noHours ? 'Set your hours' : 'Open the Week'}
          </a>
          {data.calendarStatus !== 'active' && <a href={a('settings')}>Google Calendar, in Settings</a>}
        </div>
      </div>
    );
  }

  if (part === 'booked') {
    const next = data.nextUp.filter((b) => b.eventTypeId === lane.id).slice(0, 5);
    return (
      <div>
        {head('Booked', lane.name)}
        <dl className="wk-facts">
          <div>
            <dt>In 30 days</dt>
            <dd>{lane.booked}</dd>
          </div>
          <div>
            <dt>By new people</dt>
            <dd>{bookedByNew(lane)}</dd>
          </div>
        </dl>
        {model.booked.flag && (
          <p className="wk-warning">
            {model.booked.flag} in the last 30 days. <a href={a('messages')}>See which, on Messages</a>
          </p>
        )}
        <p className="wk-side-eyebrow" style={{ marginTop: 14 }}>
          Next up
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

  return (
    <LanePanel
      lane={lane}
      data={data}
      slug={slug}
      head={
        <>
          <p className="wk-side-eyebrow">Service</p>
          <div className="wk-side-head">
            <h3 className="svc-heading">
              <ServiceBadge name={lane.name} color={lane.color} />
              {lane.name}
            </h3>
            <button type="button" className="btn-link" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      }
    />
  );
}

function PagePanel({ slug, model, head }: { slug: string; model: FlowModel; head: React.ReactNode }) {
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
      {head}
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
      <dl className="wk-facts" style={{ marginTop: 14 }}>
        <div>
          <dt>New people, all services</dt>
          <dd>{model.page.arrived}</dd>
        </div>
        <div>
          <dt>Already knew you</dt>
          <dd>{model.page.returning}</dd>
        </div>
      </dl>
      <p className="wk-side-hint">
        One page for every service: people choose which one first. Those who already knew you are counted
        apart, because the questions are for strangers.{' '}
        {model.page.returning > 0 && <a href={`/admin/${slug}/people?figure=returning`}>See who</a>}
      </p>
      <p className="wk-side-hint">
        To put the page on your own website, use the embed code in <a href={`/admin/${slug}/settings`}>Settings</a>.
      </p>
    </div>
  );
}

function LanePanel({ lane, data, slug, head }: { lane: Lane; data: Payload; slug: string; head: React.ReactNode }) {
  const service = data.services.find((s) => s.id === lane.id)!;
  const who = lane.fromPage
    ? lane.fromClients
      ? 'new enquiries and existing clients'
      : 'new enquiries'
    : lane.fromClients
      ? 'existing clients'
      : null;
  const stageHref = (href: string | null) => `/admin/${slug}/${href ?? `sessions/${lane.id}`}`;

  return (
    <div>
      {head}
      <p className="wk-side-lead">
        {lane.sub}
        {service.bookingMode === 'pack' ? ' · sold as a programme' : ''}
        <br />
        <span className="wk-muted">{who ? `Offered to ${who}.` : 'Offered to nobody yet.'}</span>
      </p>

      {lane.blocking.length > 0 && (
        <div className="fl-gaps">
          <p className="wk-side-eyebrow">To connect it</p>
          <ul>
            {lane.blocking.map((st) => (
              <li key={st.id} className="is-blocking">
                <b>{st.label}</b>
                <small>{st.note}</small>
                <a href={stageHref(st.href)}>Fix this</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lane.fromPage && asksQuestions(lane) && lane.started > 0 && (
        <p className="wk-side-hint">
          {share(lane.qualified, lane.started)}% of the people who started its questions reached your calendar.
          Started and finished are kept apart: a service nobody finishes has too long a form; one everybody
          finishes but few are let through has rules that are too tight.
        </p>
      )}

      {lane.loose.length > 0 && (
        <div className="fl-gaps">
          <p className="wk-side-eyebrow">Worth setting</p>
          <ul>
            {lane.loose.map((st) => (
              <li key={st.id}>
                <b>{st.label}</b>
                <small>{st.note}</small>
                <a href={stageHref(st.href)}>Set it</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="wk-actions">
        <a className="btn-secondary" href={`/admin/${slug}/sessions/${lane.id}`}>
          Every setting for this service
        </a>
      </div>
    </div>
  );
}

/* ── Trying the page ────────────────────────────────────────────────────── */

/**
 * The real booking page, in a test run, beside its own flow.
 *
 * The same page a client gets, not a copy: in a test run it saves nothing,
 * holds no time and sends nothing (see src/lib/test-run.ts), and tells the
 * flow each step it reaches, so the route lights up as it is walked.
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

function TryLegend({ walked, lane }: { walked: { parts: Set<string>; current: string | null }; lane: Lane }) {
  const where: Record<string, string> = {
    page: 'On your page, choosing a service.',
    service: `${lane.name} chosen.`,
    questions: 'Answering the questions.',
    elsewhere: 'Sent elsewhere: this is the message they would see.',
    calendar: 'Choosing a time, and giving their details.',
    booked: 'Booked — in a test run, nothing was.',
  };
  return (
    <p className="fl-try-status" aria-live="polite">
      <span className="fl-try-dot" aria-hidden="true" />
      {walked.current ? where[walked.current] : where.page}
    </p>
  );
}

/* ── A new service ──────────────────────────────────────────────────────── */

/**
 * Naming a service goes straight into setting it up, as it did on
 * Services: a name is not a service, and dropping somebody back on the
 * flow with an unconnected lane would be the product saying "done" about a
 * thing that has not started. Back on the flow it is drawn with its gaps.
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
