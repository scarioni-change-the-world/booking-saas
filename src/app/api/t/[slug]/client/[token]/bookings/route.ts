import { fail, handleError, isResponse, ok, readJson, requireString, requireTenant } from '@/lib/api';
import { BookingError, createEntitlementBookings, resolveClientByToken } from '@/lib/booking-service';

const MAX_SLOTS_PER_REQUEST = 20;

/**
 * Redeem sessions from a package in one visit — the feature this whole
 * table structure exists for. Partial success is a normal outcome, not an
 * error: see createEntitlementBookings for why the batch isn't
 * all-or-nothing, and the response always says exactly which of the
 * requested times actually got booked.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ slug: string; token: string }> },
) {
  try {
    const { slug, token } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const { tenant, scope } = resolved;
    const client = await resolveClientByToken(scope, token);
    if (!client) return fail('Not found', 404);

    const body = await readJson(request);
    const entitlementId = requireString(body, 'entitlementId', { maxLength: 64 });

    const rawStartTimes = body.startTimes;
    if (!Array.isArray(rawStartTimes) || rawStartTimes.length === 0) {
      throw new BookingError('Pick at least one time', 400);
    }
    if (rawStartTimes.length > MAX_SLOTS_PER_REQUEST) {
      throw new BookingError(`Pick at most ${MAX_SLOTS_PER_REQUEST} times at once`, 400);
    }
    const startTimes = rawStartTimes.map((value, i) => {
      if (typeof value !== 'string' || value.length > 40) {
        throw new BookingError(`"startTimes[${i}]" is not a valid time`, 400);
      }
      return value;
    });

    const { results, remaining } = await createEntitlementBookings(
      tenant,
      scope,
      entitlementId,
      client,
      startTimes,
    );

    return ok({
      results: results.map((r) => ({
        startsAt: r.startsAt,
        status: r.status,
        booking: r.booking
          ? {
              id: r.booking.id,
              startsAt: r.booking.starts_at,
              endsAt: r.booking.ends_at,
              manageToken: r.booking.manage_token,
              meetingUrl: r.booking.meeting_url,
            }
          : null,
      })),
      remaining,
    });
  } catch (error) {
    return handleError(error);
  }
}
