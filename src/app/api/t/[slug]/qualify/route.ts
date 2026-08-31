import { handleError, isResponse, ok, readJson, requireString, requireTenant } from '@/lib/api';
import { BookingError } from '@/lib/booking-service';
import { evaluateQualification, type Question } from '@/lib/qualification';
import { completeResponse } from '@/lib/qualification-response-service';
import type { OutcomePathRow, QualificationQuestionRow } from '@/lib/db/types';

/**
 * Score a submitted questionnaire and complete the response.
 *
 * Scoring happens here, never in the browser — the client is handed questions
 * with the outcome-path flags stripped, so it has no way to compute the
 * outcome and no way to claim one.
 *
 * `responseId` names a row .../qualify/start already created when the
 * prospect gave their email, before this request — this completes it
 * (completeResponse), it doesn't create a new one. A prospect sent down the
 * 'other' path gets that path's configured message and optional redirect,
 * and never sees the calendar (brief 2.2). The copy is the tenant's to
 * write and is meant to be warm rather than a rejection.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const { scope } = resolved;
    const body = await readJson(request);
    const responseId = requireString(body, 'responseId', { maxLength: 64 });
    const answers = body.answers;

    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new BookingError('Missing "answers"', 400);
    }

    const [questionsResult, pathsResult] = await Promise.all([
      scope.select('qualification_questions').order('sort_order', { ascending: true }),
      scope.select('outcome_paths'),
    ]);
    if (questionsResult.error) throw questionsResult.error;
    if (pathsResult.error) throw pathsResult.error;

    const rows = (questionsResult.data ?? []) as unknown as QualificationQuestionRow[];
    const questions: Question[] = rows.map((r) => ({
      id: r.id,
      prompt: r.prompt,
      kind: r.kind,
      options: r.options,
      required: r.required,
      sortOrder: r.sort_order,
    }));

    const result = evaluateQualification(questions, answers as Record<string, string>);
    const outcomePathType = await completeResponse(
      scope,
      responseId,
      result.answers,
      result.outcomePathType,
    );

    if (outcomePathType === 'other') {
      const paths = (pathsResult.data ?? []) as unknown as OutcomePathRow[];
      const otherPath = paths.find((p) => p.type === 'other');
      return ok({
        outcomePathType: 'other' as const,
        responseId,
        message: otherPath?.message ?? '',
        redirectUrl: otherPath?.redirect_url ?? null,
        redirectLabel: otherPath?.redirect_label ?? null,
      });
    }

    return ok({ outcomePathType: 'meeting' as const, responseId });
  } catch (error) {
    return handleError(error);
  }
}
