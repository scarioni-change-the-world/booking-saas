import { DateTime } from 'luxon';
import { fail, handleError, isResponse, ok, requireTenant } from '@/lib/api';
import { BookingError, getAvailability } from '@/lib/booking-service';
import type { QualificationResponseRow } from '@/lib/db/types';
import type { TenantScope } from '@/lib/db';
import { serviceAsksProspectAnything } from '@/lib/qualification-response-service';
import { isTestRun } from '@/lib/test-run-server';

/** Cap the range so one request cannot ask the engine to walk years of days. */
const MAX_RANGE_DAYS = 62;

/**
 * Enforce the qualification gate.
 *
 * This is where the gate is actually enforced, not in the widget. A prospect
 * reaches the calendar only by presenting the id of a stored response whose
 * outcome path is 'meeting'; without this check anyone could skip the
 * questionnaire by calling this endpoint directly, and the product's
 * differentiator would be decorative.
 *
 * The response id is looked up through the tenant scope, so a response issued
 * by one tenant cannot unlock another tenant's calendar.
 */
async function prospectIsOnMeetingPath(
  scope: TenantScope,
  responseId: string | null,
): Promise<boolean> {
  if (!responseId) return false;

  const { data, error } = await scope
    .select('qualification_responses')
    .eq('id', responseId)
    .maybeSingle();

  if (error) throw error;
  const response = data as unknown as QualificationResponseRow | null;
  return response?.outcome_path_type === 'meeting';
}

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const { tenant, scope } = resolved;
    const params = new URL(request.url).searchParams;

    const eventTypeId = params.get('eventTypeId');
    if (!eventTypeId) throw new BookingError('Missing "eventTypeId"', 400);

    const audience = params.get('audience') === 'client' ? 'client' : 'prospect';
    // A test run is the business itself, signed in, whose answers were
    // scored but not stored — so there is no response to present.
    if (audience === 'prospect' && !(await isTestRun(request, slug))) {
      const onMeetingPath = await prospectIsOnMeetingPath(scope, params.get('responseId'));
      if (!onMeetingPath) {
        // Only gate on a questionnaire that exists. A service with nothing
        // to ask sends the visitor straight here (BookingFlow's
        // chooseEventType), and refusing them turned "no screening set up
        // yet" — the state every new business starts in — into a booking
        // page that could never take a booking.
        const asksSomething = await serviceAsksProspectAnything(scope, eventTypeId);
        if (asksSomething) return fail('Complete the questions first', 403);
      }
    }

    const today = DateTime.now().setZone(tenant.timezone);
    const from = params.get('from') ?? today.toFormat('yyyy-MM-dd');
    const to = params.get('to') ?? today.plus({ days: 30 }).toFormat('yyyy-MM-dd');

    const fromDate = DateTime.fromISO(from, { zone: tenant.timezone });
    const toDate = DateTime.fromISO(to, { zone: tenant.timezone });
    if (!fromDate.isValid || !toDate.isValid) throw new BookingError('Invalid date', 400);
    if (toDate.diff(fromDate, 'days').days > MAX_RANGE_DAYS) {
      throw new BookingError(`Range cannot exceed ${MAX_RANGE_DAYS} days`, 400);
    }

    /* A client's own link books sessions they already hold, so a paused
       service still shows its times there. Booking itself is checked
       against their balance, and a new booking still needs an active one. */
    const days = await getAvailability(tenant, scope, eventTypeId, from, to, {
      paused: audience === 'client' ? 'allow' : 'refuse',
    });
    return ok({ timezone: tenant.timezone, days });
  } catch (error) {
    return handleError(error);
  }
}
