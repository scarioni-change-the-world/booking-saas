'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import { share } from '@/lib/enquiry-analysis';
import {
  buildFlow,
  describeFlow,
  drawFlow,
  type DrawnNode,
  type FlowInput,
  type FlowModel,
  type Lane,
  type PartId,
} from '@/lib/flow';

interface NextUp {
  id: string;
  name: string;
  email: string;
  startsAt: string;
  eventTypeName: string;
}

interface Payload extends FlowInput {
  timezone: string;
  thisWeekCount: number;
  nextUp: NextUp[];
}

/** Up to this many active services — the same soft guide Services kept. */
const SOFT_CAP = 5;

export default function FlowPage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearchParams();

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /* Seeded from the address, so a link elsewhere can open a part. */
  const [selected, setSelected] = useState<PartId | null>(() => (search.get('part') as PartId | null) ?? null);
  const [view, setView] = useState<'diagram' | 'list'>(search.get('view') === 'list' ? 'list' : 'diagram');
  const [adding, setAdding] = useState(false);
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
  const drawing = useMemo(() => (model ? drawFlow(model, slug) : null), [model, slug]);

  function open(part: PartId) {
    setSelected((current) => (current === part ? null : part));
    /* On a narrow screen the panel is below the flow; bring it to where
       the person is looking, rather than leave them to find it. */
    if (typeof window !== 'undefined' && window.innerWidth < 1080) {
      requestAnimationFrame(() => sideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  const activeCount = data?.services.filter((s) => s.active).length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Flow"
        title="How people reach you"
        description="Your booking page and your clients’ own links, through to your calendar. The numbers are the last 30 days moving through. Choose any part to open it here."
        actions={
          <div className="fl-actions">
            <div className="wk-view-switch" role="group" aria-label="Show as">
              <button
                type="button"
                className="filter-chip"
                aria-pressed={view === 'diagram'}
                onClick={() => setView('diagram')}
              >
                Diagram
              </button>
              <button
                type="button"
                className="filter-chip"
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
              >
                List
              </button>
            </div>
            {!adding && (
              <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
                Add a service
              </button>
            )}
          </div>
        }
      />

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {adding && <AddService slug={slug} activeCount={activeCount} onCancel={() => setAdding(false)} />}

      {loading && <p className="status">Loading…</p>}

      {data && model && drawing && (
        <div className="wk-layout">
          <div className="fl-main">
            {/* The diagram and the list are the same model. On a phone the
                list is what shows — a squashed diagram helps nobody — and a
                screen reader always has the list and the sentence. */}
            <div className={`fl-diagram${view === 'list' ? ' is-hidden' : ''}`}>
              <svg
                className="fl-svg"
                viewBox={`0 0 ${drawing.width} ${drawing.height}`}
                role="group"
                aria-label={describeFlow(model)}
              >
                {drawing.edges.map((e) => (
                  <g key={e.id}>
                    <path className={`fl-edge tone-${e.tone}`} d={e.d} />
                    {e.label && (
                      <text className={`fl-count tone-${e.tone}`} x={e.lx} y={e.ly} textAnchor={e.anchor}>
                        {e.label}
                      </text>
                    )}
                  </g>
                ))}
                {drawing.nodes.map((n) => (
                  <Node key={n.part} node={n} selected={selected === n.part} onOpen={() => open(n.part)} />
                ))}
              </svg>
            </div>

            <FlowList
              model={model}
              selected={selected}
              onOpen={open}
              className={view === 'list' ? 'fl-list is-shown' : 'fl-list'}
            />

            {model.archived.length > 0 && (
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

          <aside className="wk-side" aria-live="polite" ref={sideRef}>
            {selected ? (
              <Panel
                key={selected}
                part={selected}
                slug={slug}
                data={data}
                model={model}
                onClose={() => setSelected(null)}
              />
            ) : (
              <Summary model={model} data={data} />
            )}
          </aside>
        </div>
      )}
    </>
  );
}

/* ── The diagram's parts ────────────────────────────────────────────────── */

function Node({ node, selected, onOpen }: { node: DrawnNode; selected: boolean; onOpen: () => void }) {
  return (
    <g
      className={`fl-node tone-${node.tone}${selected ? ' is-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${node.title}: ${node.sub}${node.flag ? `. ${node.flag}` : ''}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={9} />
      <text className="fl-title" x={node.x + node.w / 2} y={node.y + node.h / 2 - 3} textAnchor="middle">
        {clip(node.title, node.w)}
      </text>
      <text className="fl-sub" x={node.x + node.w / 2} y={node.y + node.h / 2 + 14} textAnchor="middle">
        {clip(node.sub, node.w)}
      </text>
      {node.flag && (
        <circle className="fl-flag" cx={node.x + node.w - 4} cy={node.y + 4} r={6}>
          <title>{node.flag}</title>
        </circle>
      )}
    </g>
  );
}

/** SVG text does not wrap; a long service name is shortened, never overflowed. */
function clip(text: string, width: number): string {
  const max = Math.floor((width - 16) / 7);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ── The same flow, as a list ───────────────────────────────────────────── */

function FlowList({
  model,
  selected,
  onOpen,
  className,
}: {
  model: FlowModel;
  selected: PartId | null;
  onOpen: (part: PartId) => void;
  className: string;
}) {
  const item = (part: PartId, title: string, detail: string, tone = '', flag: string | null = null) => (
    <button type="button" className={`fl-item ${tone}`} aria-pressed={selected === part} onClick={() => onOpen(part)}>
      <b>{title}</b>
      <span>{detail}</span>
      {flag && <span className="fl-item-flag">{flag}</span>}
    </button>
  );

  return (
    <ol className={className} aria-label="Your flow, step by step">
      <li>
        {item(
          'page',
          'Your page',
          `${model.page.arrived} new ${model.page.arrived === 1 ? 'person' : 'people'} arrived${
            model.page.returning ? ` · ${model.page.returning} already knew you` : ''
          }`,
          'is-door',
        )}
      </li>
      <li>
        {item(
          'questions',
          'Questions',
          model.questions.count === 0
            ? 'Nothing is asked'
            : `${model.questions.finished} of ${model.questions.started} finished · ${model.questions.leftPartway} left partway`,
        )}
        <ol>
          <li>
            {item(
              'elsewhere',
              'Elsewhere',
              `${model.elsewhere.count} sent to another next step`,
              'is-exit',
              model.elsewhere.said ? null : 'Nothing written for them',
            )}
          </li>
        </ol>
      </li>
      {model.lanes.map((lane) => (
        <li key={lane.id}>
          {item(
            lane.part,
            lane.name,
            lane.fromPage || lane.fromClients
              ? `${lane.qualified} let through · ${lane.booked} booked · ${lane.sub}`
              : 'Not connected: offered to nobody',
            lane.live ? '' : 'is-broken',
          )}
        </li>
      ))}
      <li>
        {item(
          'clients',
          'Existing clients',
          `${model.clients.count} with their own link · ${model.clients.booked} booked`,
          'is-door',
        )}
      </li>
      <li>
        {item(
          'calendar',
          'Calendar',
          model.calendar.noHours ? 'No opening hours, so nothing can be booked' : `${Math.round(model.calendar.weeklyMinutes / 6) / 10} h open a week`,
          model.calendar.noHours ? 'is-broken' : '',
          model.calendar.flag,
        )}
      </li>
      <li>{item('booked', 'Booked', `${model.booked.total} in the last 30 days`, 'is-end', model.booked.flag)}</li>
    </ol>
  );
}

/* ── With nothing chosen ────────────────────────────────────────────────── */

function Summary({ model, data }: { model: FlowModel; data: Payload }) {
  const notConnected = model.lanes.filter((l) => !l.live);
  return (
    <div>
      <p className="wk-side-eyebrow">Last 30 days</p>
      <dl className="wk-facts">
        <div>
          <dt>Reached your page</dt>
          <dd>{model.page.arrived}</dd>
        </div>
        <div>
          <dt>Booked</dt>
          <dd>{model.booked.total}</dd>
        </div>
        <div>
          <dt>Coming up this week</dt>
          <dd>{data.thisWeekCount}</dd>
        </div>
        <div>
          <dt>Sent elsewhere</dt>
          <dd>{model.elsewhere.count}</dd>
        </div>
      </dl>
      {model.calendar.noHours && (
        <p className="wk-warning">No opening hours are set, so nothing can be booked. Open Calendar to set them.</p>
      )}
      {notConnected.length > 0 && (
        <p className="wk-warning">
          {notConnected.length === 1
            ? `${notConnected[0]!.name} is not connected yet.`
            : `${notConnected.length} services are not connected yet.`}{' '}
          Its gaps are drawn as broken lines; open it to see what joins them.
        </p>
      )}
      <p className="wk-side-hint">
        Choose any part of the flow to see it here: what it is, what moved through it, and where to
        change it.
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
  onClose,
}: {
  part: PartId;
  slug: string;
  data: Payload;
  model: FlowModel;
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

  if (part === 'page') return <PagePanel slug={slug} model={model} head={head('Your page', 'The way in for new people')} />;

  if (part === 'questions') {
    return (
      <div>
        {head('Questions', 'Asked of every new enquiry')}
        <p className="wk-side-lead">
          {model.questions.count === 0
            ? 'Nothing is asked. Everyone who arrives goes straight to your services.'
            : `${model.questions.count} ${model.questions.count === 1 ? 'question' : 'questions'} every new enquiry answers, plus any a service asks of its own.`}
        </p>
        <dl className="wk-facts">
          <div>
            <dt>Finished</dt>
            <dd>
              {model.questions.finished} of {model.questions.started}
            </dd>
          </div>
          <div>
            <dt>Left partway</dt>
            <dd>{model.questions.leftPartway}</dd>
          </div>
        </dl>
        {data.questionInsights.length > 0 && (
          <>
            <p className="wk-side-eyebrow" style={{ marginTop: 14 }}>
              Where people are turned away
            </p>
            <div className="fl-insights">
              {data.questionInsights.map((q) => (
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
        <div className="wk-actions">
          <a className="btn-secondary" href={a('screening')}>
            Change your questions
          </a>
          {model.questions.leftPartway > 0 && <a href={a('people?show=unfinished')}>Who didn’t finish</a>}
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
            <dt>Sent here</dt>
            <dd>{model.elsewhere.count}</dd>
          </div>
        </dl>
        {model.elsewhere.said ? (
          <p className="wk-side-lead">
            They are shown your next-steps message
            {model.elsewhere.label ? `, with a link: “${model.elsewhere.label}”` : ''}.
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
          Everyone who books gets their own link. It skips your questions and offers only the services
          you have marked for existing clients.
        </p>
        <dl className="wk-facts">
          <div>
            <dt>With their own link</dt>
            <dd>{model.clients.count}</dd>
          </div>
          <div>
            <dt>Booked again</dt>
            <dd>{model.clients.booked}</dd>
          </div>
        </dl>
        {model.clients.offered.length === 0 ? (
          <p className="wk-warning">
            No service is offered to existing clients, so their own link has nothing to book. Open a
            service and offer it to them.
          </p>
        ) : (
          <p className="wk-side-lead">Offered to them: {model.clients.offered.join(', ')}.</p>
        )}
        <div className="wk-actions">
          <a className="btn-secondary" href={a('people')}>
            See them in People
          </a>
        </div>
      </div>
    );
  }

  if (part === 'calendar') {
    return (
      <div>
        {head('Calendar', 'When people can book')}
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
            {data.syncFailures === 1 ? '1 booking is' : `${data.syncFailures} bookings are`} not in your
            Google Calendar. They are outlined in red on the Week.
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
    return (
      <div>
        {head('Booked', 'What arrived in your diary')}
        <dl className="wk-facts">
          <div>
            <dt>In 30 days</dt>
            <dd>{model.booked.total}</dd>
          </div>
          <div>
            <dt>Coming up this week</dt>
            <dd>{data.thisWeekCount}</dd>
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
        {data.nextUp.length === 0 ? (
          <p className="wk-side-lead">Nothing booked yet. Appointments appear here as soon as someone picks a time.</p>
        ) : (
          <ul className="fl-next">
            {data.nextUp.map((b) => (
              <li key={b.id}>
                <a href={a(`people?person=${encodeURIComponent(b.email)}`)}>{b.name}</a>
                <small>
                  {b.eventTypeName} · {DateTime.fromISO(b.startsAt).setZone(data.timezone).toFormat('ccc d LLL, HH:mm')}
                </small>
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

  const lane = model.lanes.find((l) => l.part === part);
  if (!lane) {
    return (
      <div>
        {head('Not found', 'Flow')}
        <p className="wk-side-lead">That part is no longer in the flow.</p>
      </div>
    );
  }
  return <LanePanel lane={lane} data={data} slug={slug} head={head(lane.name, 'Service')} />;
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
          <dt>New people, 30 days</dt>
          <dd>{model.page.arrived}</dd>
        </div>
        <div>
          <dt>Already knew you</dt>
          <dd>{model.page.returning}</dd>
        </div>
      </dl>
      <p className="wk-side-hint">
        People who already knew you are counted apart, because the questions are for strangers.{' '}
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
  const insight = data.serviceInsights.find((i) => i.eventTypeId === lane.id);
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

      <p className="wk-side-eyebrow" style={{ marginTop: 14 }}>
        Last 30 days
      </p>
      <dl className="wk-facts">
        <div>
          <dt>Started the questions</dt>
          <dd>{insight?.started ?? 0}</dd>
        </div>
        <div>
          <dt>Let through</dt>
          <dd>{lane.qualified}</dd>
        </div>
        <div>
          <dt>Sent elsewhere</dt>
          <dd>{insight?.other ?? 0}</dd>
        </div>
        <div>
          <dt>Booked</dt>
          <dd>{lane.booked}</dd>
        </div>
      </dl>
      {insight && insight.started > 0 && (
        <p className="wk-side-hint">
          {share(lane.qualified, insight.started)}% of the people who started reached your calendar. Started and
          finished are kept apart: a service nobody finishes has too long a form; one everybody finishes but few
          are let through has rules that are too tight.
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
        <a href={`/admin/${slug}/screening?service=${encodeURIComponent(lane.id)}`}>Its questions</a>
      </div>
    </div>
  );
}

/* ── A new lane ─────────────────────────────────────────────────────────── */

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
      <div className="admin-card-title">A new service · {activeCount} of {SOFT_CAP} used</div>
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
