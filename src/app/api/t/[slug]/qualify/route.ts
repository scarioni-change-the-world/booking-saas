import {
  handleError,
  isResponse,
  ok,
  optionalString,
  readJson,
  requireTenant,
} from '@/lib/api';
import { BookingError } from '@/lib/booking-service';
import { evaluateQualification, type Question } from '@/lib/qualification';
import type { QualificationQuestionRow, TenantSettingsRow } from '@/lib/db/types';

/**
 * Score a submitted questionnaire and record the response.
 *
 * Scoring happens here, never in the browser — the client is handed questions
 * with the qualifying flags stripped, so it has no way to compute the outcome
 * and no way to claim one.
 *
 * A disqualified prospect gets the tenant's configured message and optional
 * redirect, and never sees the calendar (brief 2.2). The copy is the tenant's
 * to write and is meant to be warm rather than a rejection.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const { scope } = resolved;
    const body = await readJson(request);
    const answers = body.answers;

    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new BookingError('Missing "answers"', 400);
    }

    const email = optionalString(body, 'email', { maxLength: 320 });

    const [questionsResult, settingsResult] = await Promise.all([
      scope.select('qualification_questions').order('sort_order', { ascending: true }),
      scope.select('tenant_settings').maybeSingle(),
    ]);
    if (questionsResult.error) throw questionsResult.error;
    if (settingsResult.error) throw settingsResult.error;

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

    const { data, error } = await scope.insert('qualification_responses', {
      answers: result.answers,
      outcome: result.outcome,
      email: email ?? null,
    });
    if (error) throw error;

    const responseId = (data as unknown as Array<{ id: string }>)[0]!.id;

    if (result.outcome === 'redirected') {
      const settings = settingsResult.data as unknown as TenantSettingsRow | null;
      return ok({
        outcome: 'redirected' as const,
        responseId,
        message: settings?.disqualification_message ?? '',
        redirectUrl: settings?.disqualification_redirect_url ?? null,
        redirectLabel: settings?.disqualification_redirect_label ?? null,
      });
    }

    return ok({ outcome: 'qualified' as const, responseId });
  } catch (error) {
    return handleError(error);
  }
}
