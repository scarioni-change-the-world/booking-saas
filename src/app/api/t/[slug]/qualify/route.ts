import { handleError, isResponse, ok, readJson, requireString, requireTenant } from '@/lib/api';
import { BookingError } from '@/lib/booking-service';
import { evaluateQualification, type Question } from '@/lib/qualification';
import { completeResponse } from '@/lib/qualification-response-service';
import type { OutcomePathRow, QualificationQuestionRow, QualificationResponseRow } from '@/lib/db/types';

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

/**
 * Score a submitted questionnaire and complete the response.
 *
 * Scoring happens here, never in the browser — the client is handed questions
 * with the outcome-path flags stripped, so it has no way to compute the
 * outcome and no way to claim one.
 *
 * `responseId` names a row .../qualify/start already created when the
 * prospect gave their email, before this request — this completes it
 * (completeResponse), it doesn't create a new one. It also carries which
 * service the questionnaire was for (migration 0016): the request body
 * does not resend that id, so a prospect can't have their answers scored
 * against a different service's question set than the one they actually
 * started against.
 *
 * A prospect sent down the 'other' path gets that path's configured message
 * and optional redirect, and never sees the calendar (brief 2.2). The copy
 * is the tenant's to write and is meant to be warm rather than a rejection.
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

    const responseResult = await scope.select('qualification_responses').eq('id', responseId).maybeSingle();
    if (responseResult.error) throw responseResult.error;
    const response = responseResult.data as unknown as QualificationResponseRow | null;
    if (!response) {
      throw new BookingError('That questionnaire session was not found — please start again.', 404);
    }

    const [sharedResult, specificResult, pathsResult] = await Promise.all([
      scope.select('qualification_questions').is('event_type_id', null).order('sort_order', { ascending: true }),
      response.event_type_id
        ? scope
            .select('qualification_questions')
            .eq('event_type_id', response.event_type_id)
            .order('sort_order', { ascending: true })
        : Promise.resolve({ data: [] as QualificationQuestionRow[], error: null }),
      scope.select('outcome_paths'),
    ]);
    if (sharedResult.error) throw sharedResult.error;
    if (specificResult.error) throw specificResult.error;
    if (pathsResult.error) throw pathsResult.error;

    const rows = [
      ...((sharedResult.data ?? []) as unknown as QualificationQuestionRow[]),
      ...((specificResult.data ?? []) as unknown as QualificationQuestionRow[]),
    ];
    const questions = toQuestions(rows);

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
