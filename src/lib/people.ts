import { DateTime } from 'luxon';
import { describeGap, type Reconsideration } from './reconsideration';

/**
 * The arithmetic behind People: one row per person, however they arrived.
 *
 * A client list, an enquiry list and a booking list were three partial views
 * of the same people, and a business had to hold the join in their head —
 * "the Maya who answered on Monday is the Maya who booked on Tuesday is the
 * Maya on the Clients page". Here the three are folded together by email and
 * each person is drawn as the route they took.
 *
 * Pure and client-safe, like week.ts: the screen and its tests share one
 * definition of who someone is and what happened to them. Dates are in the
 * BUSINESS's time zone for the same reason the Week's are.
 */

export interface PeopleEntitlement {
  id: string;
  eventTypeId: string;
  eventTypeName: string;
  totalSessions: number;
  usedSessions: number;
}

export interface PeopleClient {
  id: string;
  name: string;
  email: string;
  accessToken: string;
  notes: string | null;
  createdAt: string;
  entitlements: PeopleEntitlement[];
}

export interface PeopleBooking {
  id: string;
  name: string;
  email: string;
  eventTypeName: string;
  /** The service's own colour, so its steps match its lane and its bookings. */
  eventTypeColor?: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  status: 'confirmed' | 'cancelled';
  packId: string | null;
  packSize: number | null;
}

export interface PeopleAnswer {
  questionId: string;
  prompt: string;
  answer: string;
  outcomePathType: 'meeting' | 'other' | null;
}

export interface PeopleResponse {
  id: string;
  email: string | null;
  serviceName: string | null;
  startedAt: string;
  completedAt: string | null;
  outcomePathType: 'meeting' | 'other' | null;
  answers: PeopleAnswer[];
  reconsidered: Reconsideration | null;
  /** Already a client when they started answering. */
  returning: boolean;
}

export interface PeopleInput {
  timezone: string;
  /** How far back bookings and answers were read. Clients are read in full. */
  windowStart: string;
  clients: PeopleClient[];
  bookings: PeopleBooking[];
  responses: PeopleResponse[];
}

export type StepTone =
  | 'answered'
  | 'elsewhere'
  | 'booked'
  | 'cancelled'
  | 'owed'
  | 'stopped'
  | 'added'
  | 'more';

export interface TraceStep {
  tone: StepTone;
  label: string;
  detail: string | null;
  /** A booked step is drawn in its service's colour. */
  color?: string;
}

/** Something that happened, for the history in the person's panel. */
export type PersonEvent =
  | { kind: 'answered'; at: string; response: PeopleResponse }
  | { kind: 'booked'; at: string; booking: PeopleBooking; packIndex: number | null }
  | { kind: 'added'; at: string };

export type PeopleFilter =
  | 'booked'
  | 'owed'
  | 'back'
  | 'notbooked'
  | 'elsewhere'
  | 'unfinished'
  | 'again';

export interface Owed {
  entitlementId: string;
  eventTypeName: string;
  remaining: number;
}

export interface Person {
  /** The lowercased email, or `response:<id>` for an answer with none. */
  key: string;
  name: string | null;
  email: string | null;
  client: PeopleClient | null;
  /** Oldest first. */
  events: PersonEvent[];
  trace: TraceStep[];
  owed: Owed[];
  cameBack: boolean;
  answeredAgain: boolean;
  filters: PeopleFilter[];
  lastActivityAt: string;
}

/** Someone still on the questions this recently is answering, not gone. */
const STILL_ANSWERING_MS = 2 * 60 * 60 * 1000;
/** A second booking this long after the first is a second visit. */
const CAME_BACK_MS = 24 * 60 * 60 * 1000;
/** How close a client record and a booking must be to be the same moment. */
const SAME_MOMENT_MS = 5 * 60 * 1000;

export function personKey(email: string | null, fallbackId: string): string {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : `response:${fallbackId}`;
}

const ms = (iso: string) => new Date(iso).getTime();

/**
 * How an appointment is named in a trace: a weekday and time when it is
 * this coming week, a date when it is further off or past, and the year
 * only when it is not this one.
 */
export function appointmentLabel(startsAtIso: string, timezone: string, nowIso: string): string {
  const at = DateTime.fromISO(startsAtIso, { zone: 'utc' }).setZone(timezone);
  const now = DateTime.fromISO(nowIso, { zone: 'utc' }).setZone(timezone);
  const days = at.diff(now, 'days').days;
  if (days >= 0 && days < 6) return at.toFormat('ccc HH:mm');
  if (at.year !== now.year) return at.toFormat('d LLL yyyy');
  return at.toFormat('d LLL');
}

function monthLabel(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone).toFormat('LLLL yyyy');
}

function dayLabel(iso: string, timezone: string, nowIso: string): string {
  const at = DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone);
  const now = DateTime.fromISO(nowIso, { zone: 'utc' }).setZone(timezone);
  return at.year !== now.year ? at.toFormat('d LLL yyyy') : at.toFormat('d LLL');
}

/** The answer that sent someone elsewhere, if any single one did. */
export function decisiveAnswer(response: PeopleResponse): PeopleAnswer | null {
  return response.answers.find((a) => a.outcomePathType === 'other') ?? null;
}

function responseStep(response: PeopleResponse, nowIso: string): TraceStep {
  if (!response.completedAt) {
    const recent = ms(nowIso) - ms(response.startedAt) < STILL_ANSWERING_MS;
    return {
      tone: 'stopped',
      label: recent ? 'Answering now' : 'Didn’t finish',
      detail: response.serviceName,
    };
  }
  const again = response.reconsidered ? describeGap(response.reconsidered.minutesBetween) : null;
  if (response.outcomePathType === 'other') {
    const decisive = decisiveAnswer(response);
    return {
      tone: 'elsewhere',
      label: again ? 'Answered again, sent elsewhere' : 'Sent elsewhere',
      detail: decisive ? decisive.answer : response.serviceName,
    };
  }
  return {
    tone: 'answered',
    label: again ? `Answered again ${again}` : 'Answered',
    detail: response.serviceName,
  };
}

/**
 * Everybody, folded together by email.
 *
 * Newest activity first, because the question a business brings here is
 * almost always about someone recent.
 */
export function buildPeople(input: PeopleInput, nowIso: string): Person[] {
  const { timezone } = input;
  const groups = new Map<
    string,
    { client: PeopleClient | null; bookings: PeopleBooking[]; responses: PeopleResponse[] }
  >();
  const group = (key: string) => {
    let g = groups.get(key);
    if (!g) {
      g = { client: null, bookings: [], responses: [] };
      groups.set(key, g);
    }
    return g;
  };

  for (const c of input.clients) {
    const g = group(personKey(c.email, c.id));
    // The oldest record wins if an address somehow has two.
    if (!g.client || c.createdAt < g.client.createdAt) g.client = c;
  }
  for (const b of input.bookings) group(personKey(b.email, b.id)).bookings.push(b);
  for (const r of input.responses) group(personKey(r.email, r.id)).responses.push(r);

  const people: Person[] = [];
  for (const [key, g] of groups) {
    people.push(buildPerson(key, g.client, g.bookings, g.responses, timezone, input.windowStart, nowIso));
  }
  return people.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

function buildPerson(
  key: string,
  client: PeopleClient | null,
  bookings: PeopleBooking[],
  responses: PeopleResponse[],
  timezone: string,
  windowStart: string,
  nowIso: string,
): Person {
  /* Which appointment of its programme each booking is, counted in time
     order across the whole programme, cancelled ones included — "3 of 10"
     should not renumber itself when session 2 is cancelled. */
  const packIndex = new Map<string, number>();
  const packs = new Map<string, PeopleBooking[]>();
  for (const b of bookings) {
    if (!b.packId) continue;
    const list = packs.get(b.packId) ?? [];
    list.push(b);
    packs.set(b.packId, list);
  }
  for (const list of packs.values()) {
    list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    list.forEach((b, i) => packIndex.set(b.id, i + 1));
  }

  const events: PersonEvent[] = [
    ...responses.map((r) => ({ kind: 'answered' as const, at: r.startedAt, response: r })),
    ...bookings.map((b) => ({
      kind: 'booked' as const,
      at: b.createdAt,
      booking: b,
      packIndex: packIndex.get(b.id) ?? null,
    })),
  ];

  /* A client record made in the same moment as a booking is that booking's
     paperwork — every booking creates one. A record with no booking beside
     it is somebody the business added themselves, and that is worth a step
     of its own: it is how a person they already knew came to be here. */
  if (client && client.createdAt >= windowStart) {
    const created = ms(client.createdAt);
    const madeByBooking = bookings.some((b) => {
      const d = ms(b.createdAt) - created;
      return d >= -60_000 && d <= SAME_MOMENT_MS;
    });
    if (!madeByBooking) events.push({ kind: 'added', at: client.createdAt });
  }

  events.sort((a, b) => {
    const byTime = a.at.localeCompare(b.at);
    if (byTime !== 0) return byTime;
    if (a.kind === 'booked' && b.kind === 'booked') return a.booking.startsAt.localeCompare(b.booking.startsAt);
    return 0;
  });

  /* ── The trace ─────────────────────────────────────────────────────── */
  const trace: TraceStep[] = [];
  if (client && client.createdAt < windowStart) {
    trace.push({ tone: 'added', label: `Client since ${monthLabel(client.createdAt, timezone)}`, detail: null });
  }

  const drawnPacks = new Set<string>();
  for (const e of events) {
    if (e.kind === 'answered') {
      trace.push(responseStep(e.response, nowIso));
    } else if (e.kind === 'added') {
      /* Added before anything else happened, they are somebody the business
         knew already. Added after a booking, the business gave them the
         link that booking would make today — a different thing to say. */
      trace.push({
        tone: 'added',
        label: trace.length === 0 ? 'Added by you' : 'Given their own link',
        detail: dayLabel(e.at, timezone, nowIso),
      });
    } else if (e.booking.packId) {
      /* A programme is one step, not ten. Its appointments are in the
         panel; the row only has to say how far along it is. */
      if (drawnPacks.has(e.booking.packId)) continue;
      drawnPacks.add(e.booking.packId);
      trace.push(packStep(packs.get(e.booking.packId)!, timezone, nowIso));
    } else {
      const b = e.booking;
      trace.push(
        b.status === 'cancelled'
          ? { tone: 'cancelled', label: 'Cancelled', detail: `${b.eventTypeName} · ${appointmentLabel(b.startsAt, timezone, nowIso)}` }
          : {
              tone: 'booked',
              label: b.eventTypeName,
              detail: appointmentLabel(b.startsAt, timezone, nowIso),
              color: b.eventTypeColor,
            },
      );
    }
  }

  const owed: Owed[] = (client?.entitlements ?? [])
    .map((e) => ({
      entitlementId: e.id,
      eventTypeName: e.eventTypeName,
      remaining: Math.max(0, e.totalSessions - e.usedSessions),
    }))
    .filter((o) => o.remaining > 0);
  for (const o of owed) {
    trace.push({
      tone: 'owed',
      label: o.remaining === 1 ? '1 not booked' : `${o.remaining} not booked`,
      detail: o.eventTypeName,
    });
  }

  /* ── Marks and filters ─────────────────────────────────────────────── */
  const confirmed = bookings.filter((b) => b.status === 'confirmed');

  /* Came back: answered the questions while already a client, or booked
     again on a later visit. Visits are told apart by when the booking was
     made, a programme counting once, so a person who answers and books
     within the hour is one visit and not two. */
  const visits = [
    ...new Set(bookings.map((b) => b.packId ?? b.id)),
  ].map((id) => Math.min(...bookings.filter((b) => (b.packId ?? b.id) === id).map((b) => ms(b.createdAt))));
  visits.sort((a, b) => a - b);
  const bookedAgainLater = visits.length > 1 && visits[visits.length - 1]! - visits[0]! > CAME_BACK_MS;
  const cameBack = responses.some((r) => r.returning) || bookedAgainLater;
  const answeredAgain = responses.some((r) => r.reconsidered !== null);

  const filters: PeopleFilter[] = [];
  if (confirmed.length > 0) filters.push('booked');
  if (owed.length > 0) filters.push('owed');
  if (cameBack) filters.push('back');

  /* The three that say where someone stopped, read from their latest
     answer: whatever they did most recently is where they are now. */
  const lastResponse = [...responses].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (lastResponse) {
    // Any booking since, cancelled or not: somebody who booked and then
    // cancelled did not stop at the questions.
    const bookedSince = bookings.some((b) => b.createdAt >= lastResponse.startedAt);
    if (!bookedSince) {
      if (!lastResponse.completedAt) filters.push('unfinished');
      else if (lastResponse.outcomePathType === 'other') filters.push('elsewhere');
      else filters.push('notbooked');
    }
  }
  if (answeredAgain) filters.push('again');

  const times = [
    ...responses.map((r) => r.completedAt ?? r.startedAt),
    ...bookings.map((b) => b.createdAt),
    ...(client ? [client.createdAt] : []),
  ];
  const lastActivityAt = times.reduce((a, b) => (b > a ? b : a), '');

  const latestBooking = [...bookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const firstEmail = client?.email ?? latestBooking?.email ?? responses.find((r) => r.email)?.email ?? null;

  return {
    key,
    name: client?.name ?? latestBooking?.name ?? null,
    email: firstEmail,
    client,
    events,
    trace,
    owed,
    cameBack,
    answeredAgain,
    filters,
    lastActivityAt,
  };
}

function packStep(list: PeopleBooking[], timezone: string, nowIso: string): TraceStep {
  const size = list[0]!.packSize ?? list.length;
  const confirmed = list.filter((b) => b.status === 'confirmed');
  const done = confirmed.filter((b) => b.endsAt <= nowIso).length;
  const next = confirmed.find((b) => b.startsAt > nowIso);
  const service = list[0]!.eventTypeName;
  // "Portrait programme programme" is what a service already named for
  // what it is would otherwise read as.
  const name = /programme/i.test(service) ? service : `${service} programme`;
  if (confirmed.length === 0) {
    return { tone: 'cancelled', label: name, detail: 'Cancelled' };
  }
  return {
    tone: 'booked',
    label: name,
    color: list[0]!.eventTypeColor,
    detail: next
      ? `${done} of ${size} done · next ${appointmentLabel(next.startsAt, timezone, nowIso)}`
      : `${done} of ${size} done`,
  };
}

/**
 * The trace as a row shows it: the latest steps, with anything earlier
 * folded into one "earlier" step at the front. A regular of three years
 * would otherwise push their own row off the side of the screen.
 */
export function visibleTrace(trace: readonly TraceStep[], max = 5): TraceStep[] {
  if (trace.length <= max) return [...trace];
  const hidden = trace.length - (max - 1);
  return [
    { tone: 'more', label: hidden === 1 ? '1 earlier' : `${hidden} earlier`, detail: null },
    ...trace.slice(trace.length - (max - 1)),
  ];
}

/**
 * The answers behind one of Overview's figures that this person gave.
 *
 * Overview counts answers from new enquiries over 30 days, and opens this
 * list to show who they were. Counted with the same rule as
 * loadFunnelStats — new enquiries only for the first two, returning ones
 * only for the third — so the list it opens holds exactly the people
 * behind the figure.
 */
export type FigureKind = 'meeting' | 'other' | 'returning';

export function figureAnswers(person: Person, kind: FigureKind, sinceIso: string): number {
  return person.events.filter((e) => {
    if (e.kind !== 'answered') return false;
    const r = e.response;
    if (r.startedAt < sinceIso) return false;
    if (kind === 'returning') return r.returning;
    return !r.returning && r.completedAt !== null && r.outcomePathType === kind;
  }).length;
}

/** How many people each filter would show, for the chips. */
export function filterCounts(people: readonly Person[]): Record<PeopleFilter | 'all', number> {
  const counts: Record<PeopleFilter | 'all', number> = {
    all: people.length,
    booked: 0,
    owed: 0,
    back: 0,
    notbooked: 0,
    elsewhere: 0,
    unfinished: 0,
    again: 0,
  };
  for (const p of people) for (const f of p.filters) counts[f] += 1;
  return counts;
}

/** Name or email containing the text, ignoring case. */
export function matchesSearch(person: Person, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  return (
    (person.name ?? '').toLowerCase().includes(needle) || (person.email ?? '').toLowerCase().includes(needle)
  );
}
