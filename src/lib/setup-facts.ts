import { serializeEventType } from './admin-serializers';
import type { TenantScope } from './db';
import type { EventTypeRow, OutcomePathRow } from './db/types';
import { isDeleted } from './service-deletion-server';

/**
 * Everything the setup model needs, for every service, in one pass.
 *
 * The facts a stage depends on live in four tables, and three of the four
 * are tenant-wide — one question set shared by every service, one set of
 * opening hours, one message for the other path. Asking per service would
 * be the same three answers fetched once per row to say the same thing.
 *
 * Counts, never contents: this decides whether a screen says "3 questions"
 * or "nobody is asked anything", and pulling every question's text to
 * answer that would be reading a book to count its pages.
 *
 * Shared by the service-setup endpoint and Flow, so a lane's gaps and the
 * setup screen's are the same gaps.
 */
export async function loadSetupFacts(scope: TenantScope) {
  const [services, questions, rules, paths] = await Promise.all([
    scope
      .select('event_types')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    scope.select('qualification_questions', 'id, event_type_id'),
    scope.select('availability_rules', 'id, start_time, end_time'),
    scope.select('outcome_paths'),
  ]);

  for (const result of [services, questions, rules, paths]) {
    if (result.error) throw result.error;
  }

  /* A deleted service is gone from everything the business sets up
     (migration 0029); its past bookings keep its name elsewhere. */
  const rows = ((services.data ?? []) as unknown as EventTypeRow[]).filter((r) => !isDeleted(r));

  const scoped = (questions.data ?? []) as unknown as Array<{ id: string; event_type_id: string | null }>;
  const own = new Map<string, number>();
  let globalQuestionCount = 0;
  for (const question of scoped) {
    if (question.event_type_id === null) globalQuestionCount += 1;
    else own.set(question.event_type_id, (own.get(question.event_type_id) ?? 0) + 1);
  }

  /* The path people are sent down when a meeting is not the answer. Its
     message defaults to the empty string (migration 0011), which is what
     produced a real client being shown an empty card — so "written" here
     means a non-blank message or somewhere to send them, not the row
     existing. */
  const otherPath = ((paths.data ?? []) as unknown as OutcomePathRow[]).find((path) => path.type === 'other');

  const ruleRows = (rules.data ?? []) as unknown as Array<{ start_time: string; end_time: string }>;
  const minutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  return {
    services: rows.map((row) => ({
      ...serializeEventType(row),
      ownQuestionCount: own.get(row.id) ?? 0,
    })),
    globalQuestionCount,
    availabilityRuleCount: ruleRows.length,
    /** The usual week's open time, before any one-off change. */
    weeklyMinutes: ruleRows.reduce((sum, r) => sum + Math.max(0, minutes(r.end_time) - minutes(r.start_time)), 0),
    hasOtherPathMessage: (otherPath?.message ?? '').trim().length > 0,
    hasOtherPathUrl: Boolean(otherPath?.redirect_url),
    otherPathLabel: otherPath?.redirect_url ? (otherPath.redirect_label || 'Learn more') : null,
  };
}
