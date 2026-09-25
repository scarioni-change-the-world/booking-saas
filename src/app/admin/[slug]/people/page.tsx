'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import { ReconsideredMark } from '@/components/admin/ReconsideredMark';
import {
  buildPeople,
  figureAnswers,
  filterCounts,
  matchesSearch,
  visibleTrace,
  type FigureKind,
  type PeopleFilter,
  type PeopleInput,
  type Person,
  type PersonEvent,
  type TraceStep,
} from '@/lib/people';

interface EventType {
  id: string;
  name: string;
  active: boolean;
  bookingMode: 'single' | 'pack';
  packSize: number | null;
}

type InviteStatus = 'sent' | 'failed' | 'not_configured';

const FILTERS: Array<{ key: PeopleFilter | 'all'; label: string }> = [
  { key: 'all', label: 'Everyone' },
  { key: 'booked', label: 'Booked' },
  { key: 'owed', label: 'Owed a session' },
  { key: 'back', label: 'Came back' },
  { key: 'notbooked', label: 'Could book, didn’t' },
  { key: 'elsewhere', label: 'Sent elsewhere' },
  { key: 'unfinished', label: 'Didn’t finish' },
  { key: 'again', label: 'Answered again' },
];

/* The words the old Enquiries list used in its links, so a bookmark or an
   old figure still lands on the nearest thing. */
const LEGACY_SHOW: Record<string, PeopleFilter> = {
  other: 'elsewhere',
  'in-progress': 'unfinished',
  returning: 'back',
};

/* Overview's figures, and what each is called there. */
const FIGURES: Record<FigureKind, string> = {
  meeting: 'Went on to book',
  other: 'Sent somewhere else',
  returning: 'Worked with you before',
};
const FIGURE_DAYS = 30;

function seedFigure(value: string | null): FigureKind | null {
  return value === 'meeting' || value === 'other' || value === 'returning' ? value : null;
}

function seedFilter(show: string | null): PeopleFilter | 'all' {
  if (!show) return 'all';
  if (FILTERS.some((f) => f.key === show)) return show as PeopleFilter | 'all';
  return LEGACY_SHOW[show] ?? 'all';
}

/**
 * What actually happened to the invite, said plainly. 'not_configured' is
 * its own case rather than a kind of failure: nothing is broken, email
 * simply isn't set up yet, and the fix is not a retry.
 */
function inviteMessage(name: string, status: InviteStatus | null): string | null {
  if (status === null) return `${name} has their own link. Copy it from their panel to send it yourself.`;
  if (status === 'sent') return `${name} has their own link — it's on its way to them.`;
  if (status === 'not_configured') {
    return `${name} has their own link, but no email was sent: email isn't set up yet. Copy the link from their panel and send it yourself.`;
  }
  return `${name} has their own link, but the email didn't go out. Try "Send link" again, or copy it and send it yourself.`;
}

export default function PeoplePage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearchParams();

  const [data, setData] = useState<PeopleInput | null>(null);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /* Seeded once from the address, like the Week: a figure elsewhere can
     open this list already narrowed, or with one person already open. */
  const [filter, setFilter] = useState<PeopleFilter | 'all'>(() => seedFilter(search.get('show')));
  const [figure, setFigure] = useState<FigureKind | null>(() => seedFigure(search.get('figure')));
  const [text, setText] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(
    () => search.get('person')?.trim().toLowerCase() || null,
  );
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [people, types] = await Promise.all([
        adminFetchJson<PeopleInput>(`/api/admin/${slug}/people`),
        adminFetchJson<{ eventTypes: EventType[] }>(`/api/admin/${slug}/event-types`).catch(() => ({
          eventTypes: [] as EventType[],
        })),
      ]);
      setData(people);
      setEventTypes(types.eventTypes.filter((t) => t.active));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const { people, figureSince } = useMemo(() => {
    const now = Date.now();
    return {
      people: data ? buildPeople(data, new Date(now).toISOString()) : [],
      figureSince: new Date(now - FIGURE_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    };
  }, [data]);
  const counts = useMemo(() => filterCounts(people), [people]);
  const shown = useMemo(
    () =>
      people.filter((p) => {
        if (!matchesSearch(p, text)) return false;
        if (figure) return figureAnswers(p, figure, figureSince) > 0;
        return filter === 'all' || p.filters.includes(filter);
      }),
    [people, filter, figure, figureSince, text],
  );
  const figureTotal = useMemo(
    () => (figure ? people.reduce((n, p) => n + figureAnswers(p, figure, figureSince), 0) : 0),
    [people, figure, figureSince],
  );
  const selected = people.find((p) => p.key === selectedKey) ?? null;

  return (
    <>
      <PageHeader
        title="Everyone, with the route they took"
        description="Everyone who answered, booked or was added by you in the last year, most recent first."
        actions={
          !adding ? (
            <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
              Add someone you know
            </button>
          ) : undefined
        }
      />

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice notice-muted" role="status">
          {notice}
        </div>
      )}

      {adding && (
        <AddPerson
          slug={slug}
          onCancel={() => setAdding(false)}
          onAdded={async (email, message) => {
            setAdding(false);
            setNotice(message);
            await load();
            setSelectedKey(email.trim().toLowerCase());
          }}
        />
      )}

      {loading && <p className="status">Loading…</p>}

      {!loading && data && (
        <>
          <div className="pp-toolbar">
            <div className="filter-chip-row pp-chips" role="group" aria-label="Show">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`filter-chip${!figure && filter === f.key ? ' active' : ''}`}
                  aria-pressed={!figure && filter === f.key}
                  onClick={() => {
                    setFigure(null);
                    setFilter(f.key);
                  }}
                  disabled={f.key !== 'all' && counts[f.key] === 0 && filter !== f.key}
                >
                  {f.label} <span className="pp-chip-count">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <label className="pp-search">
              <span className="sr-only">Find someone</span>
              <input
                type="search"
                placeholder="Find by name or email"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
          </div>

          {figure && (
            /* Said in the figure's own words and numbers, so the count on
               Overview and the rows here can be checked against each other.
               One person can give two answers, and when they have, the
               difference is said rather than left to look like an error. */
            <div className="notice notice-muted pp-figure" role="status">
              <span className="pp-figure-label">From Overview: {FIGURES[figure]}</span>
              <span>
                {figure === 'returning' ? 'Answers from people you already knew' : 'New enquiries'}, last{' '}
                {FIGURE_DAYS} days · {figureTotal === 1 ? '1 answer' : `${figureTotal} answers`}
                {figureTotal !== shown.length && !text
                  ? `, from ${shown.length === 1 ? '1 person' : `${shown.length} people`}`
                  : ''}
              </span>
              <button type="button" className="btn-link" onClick={() => setFigure(null)}>
                Show everyone
              </button>
            </div>
          )}

          <div className="wk-layout">
            <div className="pp-list-wrap">
              {people.length === 0 ? (
                <p className="pp-empty">
                  Nobody yet. When someone answers your questions or books, they appear here with
                  the route they took. Somebody you already know can be added now.
                </p>
              ) : shown.length === 0 ? (
                <p className="pp-empty">Nobody matches that.</p>
              ) : (
                <ul className="pp-list">
                  {shown.map((p) => (
                    <li key={p.key}>
                      <PersonRow
                        person={p}
                        selected={p.key === selectedKey}
                        onSelect={() => setSelectedKey(p.key === selectedKey ? null : p.key)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <aside className="wk-side" aria-live="polite">
              {selected ? (
                <PersonPanel
                  key={selected.key}
                  person={selected}
                  slug={slug}
                  timezone={data.timezone}
                  eventTypes={eventTypes}
                  onClose={() => setSelectedKey(null)}
                  onNotice={setNotice}
                  onChanged={load}
                />
              ) : (
                <Summary people={people} />
              )}
            </aside>
          </div>
        </>
      )}
    </>
  );
}

/* ── A row ──────────────────────────────────────────────────────────────── */

function PersonRow({
  person,
  selected,
  onSelect,
}: {
  person: Person;
  selected: boolean;
  onSelect: () => void;
}) {
  const steps = visibleTrace(person.trace);
  const owed = person.owed.reduce((n, o) => n + o.remaining, 0);
  return (
    <button type="button" className={`pp-row${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
      <span className="pp-who">
        <b>{person.name ?? person.email ?? 'No email given'}</b>
        {person.name && <small>{person.email ?? 'no email'}</small>}
        {(person.cameBack || owed > 0 || person.answeredAgain) && (
          <span className="pp-marks">
            {person.cameBack && <span className="pp-mark back">Came back</span>}
            {owed > 0 && <span className="pp-mark owes">Owed {owed}</span>}
            {person.answeredAgain && <span className="pp-mark again">Answered again</span>}
          </span>
        )}
      </span>
      <ol className="pp-trace" aria-label="Their route">
        {steps.map((s, i) => (
          <Step key={i} step={s} />
        ))}
      </ol>
    </button>
  );
}

function Step({ step }: { step: TraceStep }) {
  return (
    <li className={`pp-step tone-${step.tone}`}>
      <i aria-hidden="true" />
      <span>
        {step.label}
        {step.detail && <small>{step.detail}</small>}
      </span>
    </li>
  );
}

/* ── With nobody chosen ─────────────────────────────────────────────────── */

function Summary({ people }: { people: Person[] }) {
  const clients = people.filter((p) => p.client).length;
  const owed = people.reduce((n, p) => n + p.owed.reduce((m, o) => m + o.remaining, 0), 0);
  const owedPeople = people.filter((p) => p.owed.length > 0).length;
  return (
    <div>
      <p className="wk-side-eyebrow">Everyone</p>
      <dl className="wk-facts">
        <div>
          <dt>People</dt>
          <dd>{people.length}</dd>
        </div>
        <div>
          <dt>With their own link</dt>
          <dd>{clients}</dd>
        </div>
      </dl>
      {owed > 0 && (
        <p className="wk-warning">
          {owed === 1 ? '1 session is' : `${owed} sessions are`} paid for and not booked, across{' '}
          {owedPeople === 1 ? '1 person' : `${owedPeople} people`}.
        </p>
      )}
      <div className="pp-legend" aria-hidden="true">
        <span className="pp-step tone-answered"><i />Answered</span>
        <span className="pp-step tone-elsewhere"><i />Sent elsewhere</span>
        <span className="pp-step tone-booked"><i />Booked</span>
        <span className="pp-step tone-owed"><i />Not booked yet</span>
        <span className="pp-step tone-stopped"><i />Stopped</span>
      </div>
      <p className="wk-side-hint">
        Choose someone to see everything they answered and booked, their own link, and the
        sessions they have left.
      </p>
    </div>
  );
}

/* ── One person, in full ────────────────────────────────────────────────── */

function PersonPanel({
  person,
  slug,
  timezone,
  eventTypes,
  onClose,
  onNotice,
  onChanged,
}: {
  person: Person;
  slug: string;
  timezone: string;
  eventTypes: EventType[];
  onClose: () => void;
  onNotice: (message: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const base = `/api/admin/${slug}/clients`;
  const client = person.client;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [name, setName] = useState(person.name ?? '');
  const [emailNow, setEmailNow] = useState(true);
  const [grant, setGrant] = useState({ eventTypeId: '', sessions: '10' });

  const link = client && typeof window !== 'undefined'
    ? `${window.location.origin}/t/${slug}/client/${client.accessToken}`
    : '';
  const displayName = person.name ?? person.email ?? 'This person';

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    onNotice(null);
    try {
      await action();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const giveLink = () =>
    run('give', async () => {
      const result = await adminFetchJson<{ inviteStatus: InviteStatus | null }>(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: person.email, sendInvite: emailNow }),
      });
      onNotice(inviteMessage(name.trim(), result.inviteStatus));
      await onChanged();
    });

  const sendLink = () =>
    run('send', async () => {
      const result = await adminFetchJson<{ inviteStatus: InviteStatus }>(`${base}/${client!.id}/invite`, {
        method: 'POST',
      });
      onNotice(
        result.inviteStatus === 'sent'
          ? `${client!.name}'s link is on its way to them.`
          : inviteMessage(client!.name, result.inviteStatus),
      );
    });

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', link);
    }
  }

  const addSessions = (event: React.FormEvent) => {
    event.preventDefault();
    if (!grant.eventTypeId) return;
    void run('grant', async () => {
      await adminFetchJson(`${base}/${client!.id}/entitlements`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventTypeId: grant.eventTypeId, sessions: Number(grant.sessions) }),
      });
      setGrant({ eventTypeId: '', sessions: '10' });
      await onChanged();
    });
  };

  const removeSessions = (entitlementId: string) =>
    run(`ent-${entitlementId}`, async () => {
      await adminFetchJson(`${base}/${client!.id}/entitlements/${entitlementId}`, { method: 'DELETE' });
      await onChanged();
    });

  const removeClient = () =>
    run('remove', async () => {
      await adminFetchJson(`${base}/${client!.id}`, { method: 'DELETE' });
      setRemoving(false);
      onNotice(`${client!.name}'s link no longer works. Their bookings are kept.`);
      await onChanged();
    });

  const hadBooking = person.events.some((e) => e.kind === 'booked');
  const history = [...person.events].reverse();
  const owedLeft = (client?.entitlements ?? []).reduce(
    (sum, e) => sum + Math.max(0, e.totalSessions - e.usedSessions),
    0,
  );

  return (
    <div>
      <div className="wk-side-head">
        <h3>{displayName}</h3>
        <button type="button" className="btn-link" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="wk-side-lead">
        {person.name && person.email && (
          <>
            {person.email}
            <br />
          </>
        )}
        <span className="wk-muted">
          {client
            ? `Has their own link since ${DateTime.fromISO(client.createdAt).setZone(timezone).toFormat('d LLLL yyyy')}`
            : 'No link of their own yet'}
        </span>
      </p>

      <ol className="pp-trace pp-trace-panel" aria-label="Their route">
        {person.trace.map((s, i) => (
          <Step key={i} step={s} />
        ))}
      </ol>

      {/* What they are still owed is the one thing here that needs you:
          said first, in Ochre, with the way to act on it. */}
      {client && owedLeft > 0 && (
        <p className="wk-warning">
          <span>
            {owedLeft === 1 ? '1 session' : `${owedLeft} sessions`} paid for and not booked yet.{' '}
            {person.email && (
              <button type="button" className="btn-link" disabled={busy === 'send'} onClick={() => void sendLink()}>
                {busy === 'send' ? 'Sending…' : 'Send their link'}
              </button>
            )}
          </span>
        </p>
      )}

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {/* ── Their own link ── */}
      <section className="pp-section">
        <p className="wk-side-eyebrow">Their own link</p>
        {client ? (
          <>
            <code className="pp-link">{link}</code>
            {/* One key, and Copy as a quiet link beside it. While they owe
                sessions, the Ochre line above already carries "Send their
                link", so it is not offered twice. */}
            <div className="wk-actions" style={{ marginTop: 10 }}>
              {owedLeft === 0 && (
                <button type="button" className="btn-secondary" disabled={busy === 'send'} onClick={() => void sendLink()}>
                  {busy === 'send' ? 'Sending…' : 'Send link'}
                </button>
              )}
              <button type="button" className="btn-link" onClick={() => void copyLink()}>
                {copied ? 'Copied' : 'Copy the link'}
              </button>
            </div>
            <p className="wk-side-hint">
              It skips your questions and offers only the services you have marked for existing
              clients.
            </p>
          </>
        ) : person.email ? (
          <>
            <p className="wk-side-lead" style={{ marginTop: 0 }}>
              {hadBooking
                ? 'Everyone who books gets one automatically. This booking was made before that, or the link could not be made at the time.'
                : 'They have only answered your questions. A link of their own lets them book without answering again.'}
            </p>
            {!person.name && (
              <div className="field">
                <label htmlFor="pp-give-name">Their name</label>
                <input id="pp-give-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            <label className="pp-check">
              <input type="checkbox" checked={emailNow} onChange={(e) => setEmailNow(e.target.checked)} />
              Email it to them now
            </label>
            <div className="wk-actions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn-primary"
                disabled={busy === 'give' || !name.trim()}
                onClick={() => void giveLink()}
              >
                {busy === 'give' ? 'Working…' : 'Give them their own link'}
              </button>
            </div>
          </>
        ) : (
          <p className="wk-side-lead" style={{ marginTop: 0 }}>
            No email was given, so there is no way to reach them.
          </p>
        )}
      </section>

      {/* ── Sessions ── */}
      {client && (
        <section className="pp-section">
          <p className="wk-side-eyebrow">Sessions</p>
          {client.entitlements.length === 0 ? (
            <p className="wk-side-lead" style={{ marginTop: 0 }}>
              None. Sessions appear here when they buy a programme, or when you add them.
            </p>
          ) : (
            <ul className="pp-sessions">
              {client.entitlements.map((e) => {
                const left = e.totalSessions - e.usedSessions;
                return (
                  <li key={e.id}>
                    <span>
                      {e.eventTypeName}
                      <small>
                        {left > 0 ? `${left} of ${e.totalSessions} left` : `all ${e.totalSessions} used`}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="btn-link"
                      disabled={busy === `ent-${e.id}`}
                      onClick={() => void removeSessions(e.id)}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {eventTypes.length > 0 && (
            <form className="pp-grant" onSubmit={addSessions}>
              <div className="field">
                <label htmlFor="pp-grant-type">Add sessions for</label>
                <select
                  id="pp-grant-type"
                  required
                  value={grant.eventTypeId}
                  onChange={(e) => {
                    const matched = eventTypes.find((t) => t.id === e.target.value);
                    setGrant({
                      eventTypeId: e.target.value,
                      sessions:
                        matched?.bookingMode === 'pack' && matched.packSize ? String(matched.packSize) : grant.sessions,
                    });
                  }}
                >
                  <option value="" disabled>
                    Choose a service
                  </option>
                  {eventTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.bookingMode === 'pack' ? ` (programme of ${t.packSize})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field pp-grant-count">
                <label htmlFor="pp-grant-sessions">How many</label>
                <input
                  id="pp-grant-sessions"
                  type="number"
                  min={1}
                  max={1000}
                  required
                  value={grant.sessions}
                  onChange={(e) => setGrant({ ...grant, sessions: e.target.value })}
                />
              </div>
              <button type="submit" className="btn-secondary" disabled={busy === 'grant'}>
                {busy === 'grant' ? 'Adding…' : 'Add'}
              </button>
            </form>
          )}
        </section>
      )}

      {/* ── Everything that happened ── */}
      {history.length > 0 && (
        <section className="pp-section">
          <p className="wk-side-eyebrow">Everything, newest first</p>
          <ul className="pp-history">
            {history.map((e, i) => (
              <li key={i}>
                <HistoryItem event={e} slug={slug} timezone={timezone} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {client && (
        <section className="pp-section">
          {removing ? (
            <div className="wk-cancel" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
              <p className="wk-side-lead" style={{ marginTop: 0 }}>
                {client.name}&rsquo;s link stops working and any sessions they have left are removed.
                Their bookings stay as they are.
              </p>
              <div className="wk-actions" style={{ marginTop: 0 }}>
                <button type="button" className="btn-primary" disabled={busy === 'remove'} onClick={() => void removeClient()}>
                  {busy === 'remove' ? 'Removing…' : 'Remove their link'}
                </button>
                <button type="button" className="btn-link" onClick={() => setRemoving(false)}>
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-link" onClick={() => setRemoving(true)}>
              Remove their link
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function HistoryItem({ event, slug, timezone }: { event: PersonEvent; slug: string; timezone: string }) {
  const when = (iso: string, format: string) => DateTime.fromISO(iso).setZone(timezone).toFormat(format);

  if (event.kind === 'added') {
    return (
      <div className="pp-hist">
        <span className="pp-step tone-added"><i aria-hidden="true" /></span>
        <div>
          <b>Added by you</b>
          <small>{when(event.at, 'd LLL yyyy')}</small>
        </div>
      </div>
    );
  }

  if (event.kind === 'booked') {
    const b = event.booking;
    const date = when(b.startsAt, 'yyyy-MM-dd');
    return (
      <div className="pp-hist">
        <span className={`pp-step tone-${b.status === 'cancelled' ? 'cancelled' : 'booked'}`}>
          <i aria-hidden="true" />
        </span>
        <div>
          <b>
            {b.eventTypeName}
            {event.packIndex !== null && b.packSize ? ` · ${event.packIndex} of ${b.packSize}` : ''}
          </b>
          <small>
            {when(b.startsAt, 'ccc d LLL yyyy, HH:mm')}
            {b.status === 'cancelled' ? ' · cancelled' : ''}
          </small>
          <a className="pp-hist-link" href={`/admin/${slug}/week?from=${date}`}>
            On the Week
          </a>
        </div>
      </div>
    );
  }

  const r = event.response;
  const outcome = !r.completedAt
    ? 'Didn’t finish the questions'
    : r.outcomePathType === 'other'
      ? 'Sent elsewhere'
      : 'Answered, could book';
  const tone = !r.completedAt ? 'stopped' : r.outcomePathType === 'other' ? 'elsewhere' : 'answered';
  return (
    <div className="pp-hist">
      <span className={`pp-step tone-${tone}`}>
        <i aria-hidden="true" />
      </span>
      <div>
        <b>{outcome}</b>
        <small>
          {r.serviceName ? `${r.serviceName} · ` : ''}
          {when(r.startedAt, 'd LLL yyyy, HH:mm')}
          {r.returning ? ' · already had their own link' : ''}
        </small>
        {r.reconsidered && <ReconsideredMark reconsidered={r.reconsidered} />}
        {r.answers.length > 0 && (
          <details className="pp-answers">
            <summary>What they answered</summary>
            {r.answers.map((a) => (
              <div key={a.questionId} className="answer-pair">
                <p className="answer-pair-question">{a.prompt}</p>
                <p className="answer-pair-answer">{a.answer}</p>
                {a.outcomePathType === 'other' && <p className="answer-pair-path">This answer led to another next step</p>}
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}

/* ── Somebody the business already knows ────────────────────────────────── */

function AddPerson({
  slug,
  onCancel,
  onAdded,
}: {
  slug: string;
  onCancel: () => void;
  onAdded: (email: string, message: string | null) => Promise<void>;
}) {
  // Emailing defaults on: a link that never reaches the person is the
  // failure this whole step exists to stop.
  const [form, setForm] = useState({ name: '', email: '', sendInvite: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ inviteStatus: InviteStatus | null }>(`/api/admin/${slug}/clients`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      await onAdded(form.email, inviteMessage(form.name, result.inviteStatus));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div className="admin-card-title">Someone you already know</div>
      <p className="section-note" style={{ maxWidth: '62ch', marginTop: 0 }}>
        A customer from before, or somebody you met in person. They get their own link: it skips
        your questions and offers the services you have marked for existing clients.
      </p>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-field-row">
        <div className="field">
          <label htmlFor="pp-new-name">Name</label>
          <input
            id="pp-new-name"
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="pp-new-email">Email</label>
          <input
            id="pp-new-email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
      </div>
      <label className="pp-check" style={{ margin: '-4px 0 14px' }}>
        <input
          type="checkbox"
          checked={form.sendInvite}
          onChange={(e) => setForm({ ...form, sendInvite: e.target.checked })}
        />
        Email them their link now
      </label>
      <div className="actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className="btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
