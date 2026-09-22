import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeEventType } from '@/lib/admin-serializers';
import type { EventTypeRow, OutcomePathRow } from '@/lib/db/types';

/**
 * Everything the setup model needs, for every service, in one request.
 *
 * The facts a stage depends on live in four tables, and three of the four
 * are tenant-wide — one question set shared by every service, one set of
 * opening hours, one message for the other path. Asking per service would
 * be the same three answers fetched once per row to say the same thing.
 *
 * Counts, never contents: this endpoint decides whether a screen says "3
 * questions" or "nobody is asked anything", and pulling every question's
 * text to answer that would be reading a book to count its pages.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const [services, questions, rules, paths] = await Promise.all([
      scope
        .select('event_types')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      scope.select('qualification_questions', 'id, event_type_id'),
      scope.select('availability_rules', 'id'),
      scope.select('outcome_paths'),
    ]);

    for (const result of [services, questions, rules, paths]) {
      if (result.error) throw result.error;
    }

    const rows = (services.data ?? []) as unknown as EventTypeRow[];

    const scoped = (questions.data ?? []) as unknown as Array<{
      id: string;
      event_type_id: string | null;
    }>;
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
    const otherPath = ((paths.data ?? []) as unknown as OutcomePathRow[]).find(
      (path) => path.type === 'other',
    );

    return ok({
      services: rows.map((row) => ({
        ...serializeEventType(row),
        ownQuestionCount: own.get(row.id) ?? 0,
      })),
      globalQuestionCount,
      availabilityRuleCount: (rules.data ?? []).length,
      hasOtherPathMessage: (otherPath?.message ?? '').trim().length > 0,
      hasOtherPathUrl: Boolean(otherPath?.redirect_url),
    });
  } catch (error) {
    return handleError(error);
  }
}
