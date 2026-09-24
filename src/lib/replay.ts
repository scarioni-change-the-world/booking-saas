/**
 * What a routing change would have done, shown before it is saved.
 *
 * Deciding that an answer should close the calendar used to be a guess:
 * flip it, save, and find out over the next month. But the last 30 days of
 * answers are already stored, so they can be run again under the new rule
 * and the difference read off — who would have reached the calendar, who
 * would have been sent elsewhere, which real bookings came from people the
 * new rule would turn away, and whether the week had room for the rest.
 *
 * Pure and client-safe: the Questions page replays on every toggle without
 * asking the server again.
 *
 * Both sides are worked out under the rules as they are NOW, with only the
 * question being edited swapped for its draft. Comparing against what
 * actually happened would mix in every other change made during the month,
 * and the figure would claim credit for edits this one did not make.
 */

export type Path = 'meeting' | 'other';

export interface ReplayQuestion {
  id: string;
  kind: 'text' | 'yes_no' | 'single_choice';
  options: Array<{ label: string; outcomePathType: Path }>;
}

export interface ReplayResponse {
  id: string;
  eventTypeId: string | null;
  /** Whether a confirmed booking followed this answer set. */
  booked: boolean;
  answers: Array<{ questionId: string; answer: string; outcomePathType: Path | null }>;
}

export interface Capacity {
  /** Usual open time across the 30 days. */
  openMinutes: number;
  /** Time already booked across the same 30 days. */
  bookedMinutes: number;
  /** Length of each service, for pricing extra bookings in time. */
  durations: Record<string, number>;
}

/**
 * Where one answer leads under a set of rules: the question's current
 * option with that label, or — for an answer whose option has since been
 * renamed or removed — where it led when it was given.
 */
function pathOf(answer: ReplayResponse['answers'][number], rules: ReadonlyMap<string, ReplayQuestion>): Path | null {
  const question = rules.get(answer.questionId);
  if (question && question.kind !== 'text') {
    const option = question.options.find((o) => o.label === answer.answer);
    if (option) return option.outcomePathType;
  }
  return answer.outcomePathType;
}

/** One answer set's outcome: any answer that leads elsewhere sends the person there. */
export function outcomeUnder(response: ReplayResponse, rules: ReadonlyMap<string, ReplayQuestion>): Path {
  return response.answers.some((a) => pathOf(a, rules) === 'other') ? 'other' : 'meeting';
}

export interface ReplayResult {
  /** Answer sets in the window that include the question being edited. */
  answered: number;
  before: { calendar: number; elsewhere: number };
  after: { calendar: number; elsewhere: number };
  /** Let through now, sent elsewhere under the draft. */
  nowTurnedAway: number;
  /** Sent elsewhere now, let through under the draft. */
  nowLetThrough: number;
  /** Real bookings from people the draft would have sent elsewhere. */
  bookingsLost: number;
  /** Of the newly let through, how many would have booked at last month's rate. */
  bookingsGained: number;
  bookingsBefore: number;
  /** Last month's share of people let through who went on to book. */
  bookingRate: number;
  capacity: {
    openMinutes: number;
    usedBefore: number;
    usedAfter: number;
    /** Minutes short of room, or 0 when there was room for everyone. */
    shortBy: number;
  } | null;
}

/**
 * Replay the window with one question swapped for its draft.
 *
 * Only answer sets that include that question are counted: a service's own
 * question is never put to people booking a different service, and they
 * should not appear in its figures as though it had been.
 */
export function replay(
  responses: readonly ReplayResponse[],
  current: readonly ReplayQuestion[],
  draft: ReplayQuestion,
  capacity: Capacity | null,
): ReplayResult {
  const now = new Map(current.map((q) => [q.id, q]));
  const next = new Map(now);
  next.set(draft.id, draft);

  const relevant = responses.filter((r) => r.answers.some((a) => a.questionId === draft.id));

  let beforeCalendar = 0;
  let afterCalendar = 0;
  let nowTurnedAway = 0;
  let nowLetThrough = 0;
  let bookingsLost = 0;
  let bookingsBefore = 0;
  let extraMinutes = 0;
  let lostMinutes = 0;

  /* Last month's rate, from everybody let through under today's rules —
     the best available guess at what a newly let-through person does. */
  const throughNow = relevant.filter((r) => outcomeUnder(r, now) === 'meeting');
  const bookedNow = throughNow.filter((r) => r.booked).length;
  const bookingRate = throughNow.length > 0 ? bookedNow / throughNow.length : 0;

  const durationOf = (r: ReplayResponse) =>
    (r.eventTypeId && capacity?.durations[r.eventTypeId]) || 0;

  let gainedExact = 0;
  for (const r of relevant) {
    const was = outcomeUnder(r, now);
    const will = outcomeUnder(r, next);
    if (was === 'meeting') beforeCalendar += 1;
    if (will === 'meeting') afterCalendar += 1;
    if (was === 'meeting' && r.booked) bookingsBefore += 1;
    if (was === 'meeting' && will === 'other') {
      nowTurnedAway += 1;
      if (r.booked) {
        bookingsLost += 1;
        lostMinutes += durationOf(r);
      }
    }
    if (was === 'other' && will === 'meeting') {
      nowLetThrough += 1;
      gainedExact += bookingRate;
      extraMinutes += bookingRate * durationOf(r);
    }
  }

  const bookingsGained = Math.round(gainedExact);

  let cap: ReplayResult['capacity'] = null;
  if (capacity && capacity.openMinutes > 0) {
    const usedBefore = capacity.bookedMinutes;
    const usedAfter = Math.max(0, Math.round(usedBefore - lostMinutes + extraMinutes));
    cap = {
      openMinutes: capacity.openMinutes,
      usedBefore,
      usedAfter,
      shortBy: Math.max(0, usedAfter - capacity.openMinutes),
    };
  }

  return {
    answered: relevant.length,
    before: { calendar: beforeCalendar, elsewhere: relevant.length - beforeCalendar },
    after: { calendar: afterCalendar, elsewhere: relevant.length - afterCalendar },
    nowTurnedAway,
    nowLetThrough,
    bookingsLost,
    bookingsGained,
    bookingsBefore,
    bookingRate,
    capacity: cap,
  };
}

/** Whether the draft changes where any answer leads. */
export function routingChanged(saved: ReplayQuestion, draft: ReplayQuestion): boolean {
  const savedPath = new Map(saved.options.map((o) => [o.label, o.outcomePathType]));
  return (
    draft.kind !== saved.kind ||
    draft.options.length !== saved.options.length ||
    draft.options.some((o) => savedPath.get(o.label) !== o.outcomePathType)
  );
}
