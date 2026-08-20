import { fail, handleError, ok, optionalBoolean, optionalString, readJson } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { normaliseOptions, requireKind } from '@/lib/admin-questions';
import { serializeQuestion } from '@/lib/admin-serializers';
import { BookingError } from '@/lib/booking-service';
import type { QualificationQuestionRow } from '@/lib/db/types';

/**
 * Update a question.
 *
 * `kind` and `options` are always sent together by the dashboard's edit form
 * — never one without the other — because validating a new options array
 * needs to know which kind it is being validated against, and accepting
 * `options` alone would leave that ambiguous without an extra read of the
 * row first. `prompt` and `required` are independent of this and can change
 * on their own, which is how the list view's own required-toggle works.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    if ((body.kind === undefined) !== (body.options === undefined)) {
      throw new BookingError('"kind" and "options" must be sent together', 400);
    }

    const patch: Partial<QualificationQuestionRow> = {};

    const prompt = optionalString(body, 'prompt', { maxLength: 500 });
    if (prompt !== undefined) patch.prompt = prompt;

    const required = optionalBoolean(body, 'required');
    if (required !== undefined) patch.required = required;

    if (body.kind !== undefined) {
      const kind = requireKind(body);
      patch.kind = kind;
      patch.options = normaliseOptions(kind, body);
    }

    if (Object.keys(patch).length === 0) {
      return fail('Nothing to update', 400);
    }

    const { data, error } = await scope
      .update('qualification_questions', patch)
      .eq('id', id)
      .select();
    if (error) throw error;

    const row = (data as unknown as QualificationQuestionRow[])[0];
    if (!row) return fail('Not found', 404);

    return ok({ question: serializeQuestion(row) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Hard delete.
 *
 * Safe here in a way it is not for event_types: a qualification_response
 * stores a full snapshot of the questions and answers at submission time
 * (see 0003_qualification.sql), so removing a question later does not
 * rewrite or orphan anything already recorded.
 */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const { error } = await scope.delete('qualification_questions').eq('id', id);
    if (error) throw error;

    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
