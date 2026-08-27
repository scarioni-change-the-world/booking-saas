import { handleError, isResponse, ok, requireTenant } from '@/lib/api';
import { toPublicQuestions, type Question } from '@/lib/qualification';
import type { QualificationQuestionRow } from '@/lib/db/types';

/**
 * The qualification questions, as the prospect sees them.
 *
 * All of them at once — the widget renders one page, not a stepwise wizard.
 * That was an explicit product decision after testing; stepwise felt like an
 * interrogation (brief 2.2).
 *
 * The response is stripped of the per-option `outcomePathType` flags. Shipping
 * them would tell the browser exactly which answers open the calendar.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const { data, error } = await resolved.scope
      .select('qualification_questions')
      .order('sort_order', { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as unknown as QualificationQuestionRow[];
    const questions: Question[] = rows.map((r) => ({
      id: r.id,
      prompt: r.prompt,
      kind: r.kind,
      options: r.options,
      required: r.required,
      sortOrder: r.sort_order,
    }));

    return ok({ questions: toPublicQuestions(questions) });
  } catch (error) {
    return handleError(error);
  }
}
