import { fail, handleError, ok, readJson, requireInt, requireString } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { grantEntitlement } from '@/lib/booking-service';
import type { EventTypeRow } from '@/lib/db/types';

/**
 * Grant or top up a package for one client. One entitlement per session
 * type per client — granting again for the same session type raises the
 * total rather than creating a second, parallel balance.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const eventTypeId = requireString(body, 'eventTypeId', { maxLength: 64 });
    const sessions = requireInt(body, 'sessions', { min: 1, max: 1000 });

    const { data: eventTypeData, error: eventTypeError } = await scope
      .select('event_types')
      .eq('id', eventTypeId)
      .maybeSingle();
    if (eventTypeError) throw eventTypeError;
    if (!eventTypeData) return fail('Unknown session type', 404);
    const eventType = eventTypeData as unknown as EventTypeRow;

    const entitlement = await grantEntitlement(scope, id, eventTypeId, sessions);

    return ok(
      {
        entitlement: {
          id: entitlement.id,
          eventTypeId: entitlement.event_type_id,
          eventTypeName: eventType.name,
          totalSessions: entitlement.total_sessions,
          usedSessions: entitlement.used_sessions,
          remaining: entitlement.total_sessions - entitlement.used_sessions,
        },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
