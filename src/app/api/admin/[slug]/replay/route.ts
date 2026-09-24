import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { listRecentResponses } from '@/lib/qualification-response-service';
import { loadSetupFacts } from '@/lib/setup-facts';
import type { Capacity, ReplayResponse } from '@/lib/replay';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const RESPONSE_LIMIT = 2000;

/**
 * Last month's answers, for replaying a routing change before it is saved
 * (src/lib/replay.ts), and the week's room to judge it against.
 *
 * New enquiries only, the same as Flow's figures: someone who already works
 * with the business and answered again is not who the questions are for,
 * and counting them would move a number the business acts on for a reason
 * that has nothing to do with the rule.
 *
 * Only what the replay needs of each answer set — which question, which
 * answer, where it led — and whether a booking followed. No emails, no
 * names: this is arithmetic, not a list of people.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const now = Date.now();
    const sinceIso = new Date(now - THIRTY_DAYS_MS).toISOString();
    const nowIso = new Date(now).toISOString();

    const [responses, facts, bookings] = await Promise.all([
      listRecentResponses(scope, sinceIso, RESPONSE_LIMIT),
      loadSetupFacts(scope),
      scope
        .select('bookings', 'qualification_response_id, starts_at, ends_at')
        .eq('status', 'confirmed')
        .gte('starts_at', sinceIso)
        .lte('starts_at', nowIso),
    ]);
    if (bookings.error) throw bookings.error;

    const rows = (bookings.data ?? []) as unknown as Array<{
      qualification_response_id: string | null;
      starts_at: string;
      ends_at: string;
    }>;

    /* Whether an answer set led to a booking is read from bookings made
       from it at any time, not only in the window: somebody who answered
       on the 3rd and booked for next month still booked. */
    const completedIds = responses.filter((r) => r.completedAt && !r.returning).map((r) => r.id);
    const bookedFrom = new Set<string>();
    if (completedIds.length > 0) {
      const followed = await scope
        .select('bookings', 'qualification_response_id')
        .eq('status', 'confirmed')
        .in('qualification_response_id', completedIds);
      if (followed.error) throw followed.error;
      for (const b of (followed.data ?? []) as unknown as Array<{ qualification_response_id: string }>) {
        bookedFrom.add(b.qualification_response_id);
      }
    }

    const replayable: ReplayResponse[] = responses
      .filter((r) => r.completedAt && !r.returning)
      .map((r) => ({
        id: r.id,
        eventTypeId: r.eventTypeId,
        booked: bookedFrom.has(r.id),
        answers: (Array.isArray(r.answers) ? r.answers : []).map((a) => {
          const answer = a as { questionId: string; answer: string; outcomePathType: 'meeting' | 'other' | null };
          return { questionId: answer.questionId, answer: answer.answer, outcomePathType: answer.outcomePathType };
        }),
      }));

    const capacity: Capacity = {
      openMinutes: Math.round((facts.weeklyMinutes * 30) / 7),
      bookedMinutes: rows.reduce(
        (sum, b) => sum + Math.max(0, (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000),
        0,
      ),
      durations: Object.fromEntries(facts.services.map((s) => [s.id, s.durationMinutes])),
    };

    return ok({ responses: replayable, capacity });
  } catch (error) {
    return handleError(error);
  }
}
