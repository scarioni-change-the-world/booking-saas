import { fail, handleError, ok, readJson } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeQuestion } from '@/lib/admin-serializers';
import type { QualificationQuestionRow } from '@/lib/db/types';

/**
 * Move a question up or down one place — the brief's "reorder with up/down
 * arrows" (§2.5), done as a straight swap of sort_order with whichever
 * neighbour is on that side, rather than renumbering the whole list.
 *
 * The swap is scoped to the question's own list (migration 0016): a global
 * question and a service-specific one keep independent sort_order
 * sequences and never trade positions with each other, even though both
 * come back from the same query and can interleave in `rows`.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const direction = body.direction;
    if (direction !== 'up' && direction !== 'down') {
      return fail('"direction" must be "up" or "down"', 400);
    }

    const all = await scope
      .select('qualification_questions')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (all.error) throw all.error;

    const rows = (all.data ?? []) as unknown as QualificationQuestionRow[];
    const current = rows.find((r) => r.id === id);
    if (!current) return fail('Not found', 404);

    const scoped = rows.filter((r) => r.event_type_id === current.event_type_id);
    const index = scoped.findIndex((r) => r.id === id);
    const neighbourIndex = direction === 'up' ? index - 1 : index + 1;
    if (neighbourIndex < 0 || neighbourIndex >= scoped.length) {
      // Already at the top or bottom of its own list. Not an error — nothing to do.
      return ok({ questions: rows.map(serializeQuestion) });
    }

    const neighbour = scoped[neighbourIndex]!;

    const [firstUpdate, secondUpdate] = await Promise.all([
      scope.update('qualification_questions', { sort_order: neighbour.sort_order }).eq('id', current.id),
      scope.update('qualification_questions', { sort_order: current.sort_order }).eq('id', neighbour.id),
    ]);
    if (firstUpdate.error) throw firstUpdate.error;
    if (secondUpdate.error) throw secondUpdate.error;

    const updated = rows.map((r) => {
      if (r.id === current.id) return { ...r, sort_order: neighbour.sort_order };
      if (r.id === neighbour.id) return { ...r, sort_order: current.sort_order };
      return r;
    });
    updated.sort((a, b) => a.sort_order - b.sort_order);

    return ok({ questions: updated.map(serializeQuestion) });
  } catch (error) {
    return handleError(error);
  }
}
