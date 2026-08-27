import {
  handleError,
  isResponse,
  ok,
  optionalString,
  readJson,
  requireEmail,
  requireString,
  requireTenant,
  fail,
} from '@/lib/api';
import { createBooking } from '@/lib/booking-service';
import type { QualificationResponseRow } from '@/lib/db/types';

/**
 * Create a booking.
 *
 * The prospect path requires a qualified response id, for the same reason the
 * availability endpoint does: the gate has to hold at every door into the
 * calendar, not just the one the widget happens to use.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const { tenant, scope } = resolved;
    const body = await readJson(request);

    const audience = body.audience === 'client' ? 'client' : 'prospect';
    const responseId = optionalString(body, 'responseId', { maxLength: 64 }) ?? null;

    if (audience === 'prospect') {
      if (!responseId) return fail('Complete the questions first', 403);

      const { data, error } = await scope
        .select('qualification_responses')
        .eq('id', responseId)
        .maybeSingle();
      if (error) throw error;

      const response = data as unknown as QualificationResponseRow | null;
      if (response?.outcome_path_type !== 'meeting') {
        return fail('Complete the questions first', 403);
      }
    }

    const booking = await createBooking(tenant, scope, {
      eventTypeId: requireString(body, 'eventTypeId', { maxLength: 64 }),
      startsAt: requireString(body, 'startsAt', { maxLength: 40 }),
      name: requireString(body, 'name', { maxLength: 200 }),
      email: requireEmail(body, 'email'),
      notes: optionalString(body, 'notes', { maxLength: 5000 }),
      qualificationResponseId: audience === 'prospect' ? responseId : null,
    });

    // TODO(milestone 2): confirmation email with .ics, meeting link and the
    // manage link; owner notification. Both go through src/lib/email once a
    // real provider is wired up (brief 7.5).

    return ok(
      {
        booking: {
          id: booking.id,
          startsAt: booking.starts_at,
          endsAt: booking.ends_at,
          manageToken: booking.manage_token,
          meetingUrl: booking.meeting_url,
        },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
