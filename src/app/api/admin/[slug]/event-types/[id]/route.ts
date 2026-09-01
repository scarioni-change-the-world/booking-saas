import {
  fail,
  handleError,
  ok,
  optionalBoolean,
  optionalString,
  readJson,
  requireInt,
} from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeEventType } from '@/lib/admin-serializers';
import { parseBookingModeForUpdate } from '@/lib/admin-event-types';
import type { EventTypeRow } from '@/lib/db/types';

/**
 * Update a session type — its details, its two visibility flags, or whether
 * it is active at all.
 *
 * There is no DELETE here on purpose. A session type is referenced by every
 * booking ever made against it (`on delete restrict` in the schema), so a
 * real delete would either fail confusingly the first time someone tries to
 * remove a type with history, or silently orphan past bookings if the
 * constraint were loosened. "Active" already exists for exactly this:
 * archiving stops it being offered without touching history. The dashboard
 * calls this route with `{ active: false }` for what a tenant experiences as
 * deleting a session type.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const patch: Partial<EventTypeRow> = {};

    const name = optionalString(body, 'name', { maxLength: 200 });
    if (name !== undefined) patch.name = name;

    const description = optionalString(body, 'description', { maxLength: 2000 });
    if (description !== undefined) patch.description = description;

    if (body.durationMinutes !== undefined) {
      patch.duration_minutes = requireInt(body, 'durationMinutes', { min: 5, max: 1440 });
    }
    if (body.bufferBeforeMinutes !== undefined) {
      patch.buffer_before_minutes = requireInt(body, 'bufferBeforeMinutes', {
        min: 0,
        max: 720,
      });
    }
    if (body.bufferAfterMinutes !== undefined) {
      patch.buffer_after_minutes = requireInt(body, 'bufferAfterMinutes', { min: 0, max: 720 });
    }

    const availableToProspects = optionalBoolean(body, 'availableToProspects');
    if (availableToProspects !== undefined) patch.available_to_prospects = availableToProspects;

    const availableToExistingClients = optionalBoolean(body, 'availableToExistingClients');
    if (availableToExistingClients !== undefined) {
      patch.available_to_existing_clients = availableToExistingClients;
    }

    const active = optionalBoolean(body, 'active');
    if (active !== undefined) patch.active = active;

    const bookingModeUpdate = parseBookingModeForUpdate(body);
    if (bookingModeUpdate !== undefined) {
      patch.booking_mode = bookingModeUpdate.bookingMode;
      patch.pack_size = bookingModeUpdate.packSize;
    }

    const { data, error } = await scope
      .update('event_types', patch)
      .eq('id', id)
      .select();
    if (error) throw error;

    const rows = data as unknown as EventTypeRow[];
    if (rows.length === 0) return fail('Not found', 404);

    return ok({ eventType: serializeEventType(rows[0]!) });
  } catch (error) {
    return handleError(error);
  }
}
