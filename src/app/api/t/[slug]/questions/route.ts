import { handleError, isResponse, ok, requireTenant } from '@/lib/api';
import { loadEventType } from '@/lib/booking-service';
import { toPublicQuestions, type Question } from '@/lib/qualification';
import type { QualificationQuestionRow } from '@/lib/db/types';
import type { TenantScope } from '@/lib/db';

function toQuestions(rows: QualificationQuestionRow[]): Question[] {
  return rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    kind: r.kind,
    options: r.options,
    required: r.required,
    sortOrder: r.sort_order,
  }));
}

async function loadScoped(scope: TenantScope, eventTypeId: string | null): Promise<QualificationQuestionRow[]> {
  let query = scope.select('qualification_questions').order('sort_order', { ascending: true });
  query = eventTypeId ? query.eq('event_type_id', eventTypeId) : query.is('event_type_id', null);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as QualificationQuestionRow[];
}

/**
 * The qualification questions for one service, as the prospect sees them —
 * everyone's shared questions, then that service's own (migration 0016).
 * Two independently-ordered lists concatenated, not one merged sort: each
 * scope keeps its own sort_order sequence, so a service-specific question's
 * position is relative to its own list, never interleaved against the
 * shared one.
 *
 * All of them at once — the widget renders one page, not a stepwise wizard.
 * That was an explicit product decision after testing; stepwise felt like an
 * interrogation (brief 2.2).
 *
 * `eventTypeId` is optional at this layer (falling back to the shared-only
 * list) for defensiveness, but the widget always supplies it now — a
 * service is picked before this is ever called.
 *
 * The response is stripped of the per-option `outcomePathType` flags. Shipping
 * them would tell the browser exactly which answers open the calendar.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const eventTypeId = new URL(request.url).searchParams.get('eventTypeId');
    if (eventTypeId) await loadEventType(resolved.scope, eventTypeId);

    const [sharedRows, specificRows] = await Promise.all([
      loadScoped(resolved.scope, null),
      eventTypeId ? loadScoped(resolved.scope, eventTypeId) : Promise.resolve([]),
    ]);

    const questions = [
      ...toPublicQuestions(toQuestions(sharedRows)),
      ...toPublicQuestions(toQuestions(specificRows)),
    ];

    return ok({ questions });
  } catch (error) {
    return handleError(error);
  }
}
