import { BookingError } from './booking-service';
import { alreadyKnown, knownSinceMap } from './enquiry-analysis';
import { findReconsideration, type Attempt, type Reconsideration } from './reconsideration';
import type { TenantScope } from './db';
import type { OutcomePathType, QualificationResponseRow } from './db/types';

/**
 * The database-touching half of a questionnaire response's lifecycle — the
 * routes under /api/t/[slug]/qualify call into this rather than querying
 * directly, the same split availability.ts/booking-service.ts and
 * blocked-slots.ts/blocked-slot-service.ts already draw elsewhere in this
 * codebase between pure logic and the DB wiring around it. There is no pure
 * half here (nothing about "start" or "complete" is meaningfully
 * DB-independent), so this file stands alone rather than pairing with one.
 */

/**
 * Begin a response: record who's here before they've answered anything.
 *
 * `eventTypeId` is which service the questionnaire is being answered for —
 * always known by this point since migration 0016's reordered flow picks a
 * service before the gate ever runs. Stamped here rather than left for
 * completion time, so a response started but never finished still shows up
 * against the right service in the funnel.
 */
export async function startResponse(
  scope: TenantScope,
  email: string,
  eventTypeId: string,
): Promise<string> {
  const { data, error } = await scope.insert('qualification_responses', {
    email,
    answers: [],
    outcome_path_type: null,
    completed_at: null,
    event_type_id: eventTypeId,
  });
  if (error) throw error;

  const row = (data as unknown as QualificationResponseRow[])[0]!;
  return row.id;
}

/**
 * Finish a response: attach the scored answers and outcome to the row
 * `startResponse` already created, rather than inserting a fresh one — the
 * row's identity (and therefore its email) was fixed the moment the
 * prospect gave it, before any answer existed.
 *
 * Idempotent on an already-completed response: returns what was actually
 * scored the first time rather than re-scoring a replay (a network retry
 * resubmitting the same form). This keeps the funnel's own numbers honest —
 * a duplicate request can't silently overwrite a real answer set, and can't
 * be double-counted as a second completion, since nothing here inserts a
 * second row or advances any count on the replay path.
 */
export async function completeResponse(
  scope: TenantScope,
  responseId: string,
  answers: unknown,
  outcomePathType: OutcomePathType,
): Promise<OutcomePathType> {
  const { data, error } = await scope
    .select('qualification_responses')
    .eq('id', responseId)
    .maybeSingle();
  if (error) throw error;

  const existing = data as unknown as QualificationResponseRow | null;
  if (!existing) {
    throw new BookingError('That questionnaire session was not found — please start again.', 404);
  }
  if (existing.completed_at) {
    return existing.outcome_path_type!;
  }

  const { error: updateError } = await scope
    .update('qualification_responses', {
      answers,
      outcome_path_type: outcomePathType,
      completed_at: new Date().toISOString(),
    })
    .eq('id', responseId);
  if (updateError) throw updateError;

  return outcomePathType;
}

/**
 * How the intake questionnaire is doing since `sinceIso`.
 *
 * These four count NEW ENQUIRIES ONLY — people who were not already
 * clients when they started answering. `returning` counts the rest.
 *
 * The split is the point. Everybody who books becomes a client, and a
 * client who comes back through the public page answers the questionnaire
 * again, so without it a business's loyal customers were counted as fresh
 * acquisition: "28 started answering" quietly included the regular of
 * three years, and the conversion rate read better than the truth. A
 * funnel that cannot tell a stranger from a customer is not measuring
 * anything.
 *
 * Powers the Overview tiles and the Enquiries breakdown, so the two never
 * quietly disagree.
 */
export interface FunnelStats {
  started: number;
  completed: number;
  meeting: number;
  other: number;
  /** People you had already worked with, answering again. */
  returning: number;
}

export async function loadFunnelStats(scope: TenantScope, sinceIso: string): Promise<FunnelStats> {
  const [responses, clients] = await Promise.all([
    scope
      .select('qualification_responses', 'outcome_path_type, completed_at, email, started_at')
      .gte('started_at', sinceIso),
    // Every client, not only recent ones: somebody who has been a customer
    // for three years is exactly the person this is here to recognise.
    scope.select('clients', 'email, created_at'),
  ]);
  if (responses.error) throw responses.error;
  if (clients.error) throw clients.error;

  const knownSince = knownSinceMap(
    (clients.data ?? []) as unknown as Array<{ email: string; created_at: string }>,
  );

  const rows = (responses.data ?? []) as unknown as Array<
    Pick<QualificationResponseRow, 'outcome_path_type' | 'completed_at' | 'email' | 'started_at'>
  >;

  const fresh = rows.filter(
    (r) => !alreadyKnown({ email: r.email, startedAt: r.started_at }, knownSince),
  );
  const completedRows = fresh.filter((r) => r.completed_at !== null);

  return {
    started: fresh.length,
    completed: completedRows.length,
    meeting: completedRows.filter((r) => r.outcome_path_type === 'meeting').length,
    other: completedRows.filter((r) => r.outcome_path_type === 'other').length,
    returning: rows.length - fresh.length,
  };
}

/** One response, as the Responses tab shows it — the funnel's numbers with a
 * name attached. `answers` is passed through as stored (question id, prompt,
 * kind and answer text, denormalised at completion time by evaluateQualification
 * — see qualification.ts's AnsweredQuestion) so a tenant can read exactly what
 * someone said without a join back to qualification_questions, whose prompts
 * may since have changed or been removed. Empty ('[]') on a response that was
 * started but never finished — that emptiness is itself the signal. */
export interface ResponseListItem {
  id: string;
  email: string | null;
  startedAt: string;
  completedAt: string | null;
  outcomePathType: OutcomePathType | null;
  answers: unknown;
  /** Which service they were answering about — null when that service has
   * since been removed. */
  eventTypeId: string | null;
  /** Set when this person had already been sent elsewhere and answered
   * again — see src/lib/reconsideration.ts for why this is surfaced rather
   * than prevented. */
  reconsidered: Reconsideration | null;
  /** True when this person was already a client before they started
   *  answering — repeat business, not a new enquiry. See alreadyKnown. */
  returning: boolean;
}

/** The most recent responses since `sinceIso`, newest first, capped at
 * `limit` — this is a glance-at-the-list view for a tenant tuning their
 * questions, not a reporting export, so an unbounded query isn't needed. */
export async function listRecentResponses(
  scope: TenantScope,
  sinceIso: string,
  limit: number,
): Promise<ResponseListItem[]> {
  const { data, error } = await scope
    .select('qualification_responses')
    .gte('started_at', sinceIso)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = (data ?? []) as unknown as QualificationResponseRow[];
  const [history, clients] = await Promise.all([
    historyFor(scope, rows),
    scope.select('clients', 'email, created_at'),
  ]);
  if (clients.error) throw clients.error;

  const knownSince = knownSinceMap(
    (clients.data ?? []) as unknown as Array<{ email: string; created_at: string }>,
  );

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    outcomePathType: r.outcome_path_type,
    answers: r.answers,
    eventTypeId: r.event_type_id,
    reconsidered: findReconsideration(asAttempt(r), history),
    returning: alreadyKnown({ email: r.email, startedAt: r.started_at }, knownSince),
  }));
}

/** A stored response as the reconsideration rules read one. */
export function asAttempt(row: QualificationResponseRow): Attempt {
  return {
    id: row.id,
    email: row.email,
    eventTypeId: row.event_type_id,
    completedAt: row.completed_at,
    outcomePathType: row.outcome_path_type,
    answers: Array.isArray(row.answers) ? (row.answers as Attempt['answers']) : [],
  };
}

/**
 * Every completed attempt by the people on this page, however long ago.
 *
 * Deliberately not limited to the same window as the list. The whole point
 * is the attempt *before* the one being looked at, and a refusal in January
 * followed by a second go in March is exactly the case worth seeing — a
 * 30-day history would miss it and report the March attempt as innocent.
 *
 * One query for the page rather than one per row: a hundred enquiries is a
 * handful of distinct addresses, and per-row lookups would be a hundred
 * round trips to answer a question about a dozen people.
 */
async function historyFor(
  scope: TenantScope,
  rows: QualificationResponseRow[],
): Promise<Attempt[]> {
  const emails = [...new Set(rows.map((r) => r.email).filter((e): e is string => !!e))];
  if (emails.length === 0) return [];

  const { data, error } = await scope
    .select('qualification_responses')
    .in('email', emails)
    .not('completed_at', 'is', null);
  if (error) throw error;

  return ((data ?? []) as unknown as QualificationResponseRow[]).map(asAttempt);
}

/**
 * Does this service ask a prospect anything at all?
 *
 * Both public entry points — the calendar and booking creation — refuse a
 * prospect who has no completed questionnaire on the meeting path. That is
 * right when there are questions. It was catastrophic when there were none:
 * BookingFlow sends a visitor straight to the calendar for a service with
 * nothing to ask (see chooseEventType), and the calendar then refused to
 * load because they had not completed questions that do not exist. The
 * visitor saw "Complete the questions first" above an empty calendar, with
 * no questions anywhere to complete.
 *
 * Which means a business with no screening could not take a single booking
 * — and that is every business on its first day, before anyone has written
 * a question. The most common possible state of a new tenant was the one
 * that did not work.
 *
 * Asked here rather than trusted from the request: a caller claiming "there
 * was nothing to answer" would otherwise walk straight past the gate.
 *
 * Scoped exactly as the public questions endpoint scopes it — the tenant's
 * shared questions plus this one service's own — so "has questions" and
 * "was asked questions" can never disagree.
 */
export async function serviceAsksProspectAnything(
  scope: TenantScope,
  eventTypeId: string | null,
): Promise<boolean> {
  const scoped = async (id: string | null) => {
    let query = scope.select('qualification_questions', 'id');
    query = id ? query.eq('event_type_id', id) : query.is('event_type_id', null);
    const { data, error } = await query.limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  };

  const [shared, specific] = await Promise.all([
    scoped(null),
    eventTypeId ? scoped(eventTypeId) : Promise.resolve(false),
  ]);

  return shared || specific;
}
