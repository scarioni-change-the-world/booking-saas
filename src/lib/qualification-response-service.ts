import { BookingError } from './booking-service';
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

/** Begin a response: record who's here before they've answered anything. */
export async function startResponse(scope: TenantScope, email: string): Promise<string> {
  const { data, error } = await scope.insert('qualification_responses', {
    email,
    answers: [],
    outcome_path_type: null,
    completed_at: null,
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

/** How the intake questionnaire is doing since `sinceIso` — the numbers
 * that tell a tenant whether a question is working: how many people even
 * started, how many finished, and of those, how many landed on a meeting
 * versus the other path. Powers both the Overview tile and the fuller
 * breakdown on the Screening page, so the two never quietly disagree. */
export interface FunnelStats {
  started: number;
  completed: number;
  meeting: number;
  other: number;
}

export async function loadFunnelStats(scope: TenantScope, sinceIso: string): Promise<FunnelStats> {
  const { data, error } = await scope
    .select('qualification_responses', 'outcome_path_type, completed_at')
    .gte('started_at', sinceIso);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<
    Pick<QualificationResponseRow, 'outcome_path_type' | 'completed_at'>
  >;
  const completedRows = rows.filter((r) => r.completed_at !== null);

  return {
    started: rows.length,
    completed: completedRows.length,
    meeting: completedRows.filter((r) => r.outcome_path_type === 'meeting').length,
    other: completedRows.filter((r) => r.outcome_path_type === 'other').length,
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
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    outcomePathType: r.outcome_path_type,
    answers: r.answers,
  }));
}
