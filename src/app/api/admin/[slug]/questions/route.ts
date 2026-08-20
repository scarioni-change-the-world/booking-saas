import { handleError, ok, readJson, requireString } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { normaliseOptions, requireKind } from '@/lib/admin-questions';
import { serializeQuestion } from '@/lib/admin-serializers';
import type { QualificationQuestionRow } from '@/lib/db/types';

/** Every screening question, in the order they are asked. */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    // A tiebreaker for rows that share a sort_order, same reasoning as the
    // event-types list route: without one, ties sort however Postgres feels
    // like on a given day.
    const { data, error } = await scope
      .select('qualification_questions')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as unknown as QualificationQuestionRow[];
    return ok({ questions: rows.map(serializeQuestion) });
  } catch (error) {
    return handleError(error);
  }
}

/** New questions go to the end of the list; reordering moves them from there. */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const prompt = requireString(body, 'prompt', { maxLength: 500 });
    const kind = requireKind(body);
    const options = normaliseOptions(kind, body);
    const required = body.required !== false;

    const last = await scope
      .select('qualification_questions', 'sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last.error) throw last.error;
    const nextSortOrder = ((last.data as { sort_order: number } | null)?.sort_order ?? -1) + 1;

    const { data, error } = await scope.insert('qualification_questions', {
      prompt,
      kind,
      options,
      required,
      sort_order: nextSortOrder,
    });
    if (error) throw error;

    const row = (data as unknown as QualificationQuestionRow[])[0]!;
    return ok({ question: serializeQuestion(row) }, 201);
  } catch (error) {
    return handleError(error);
  }
}
