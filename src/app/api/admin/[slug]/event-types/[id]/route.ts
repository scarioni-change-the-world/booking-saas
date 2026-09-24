import {
  fail,
  handleError,
  ok,
  optionalBoolean,
  optionalString,
  readJson,
  requireInt,
} from '@/lib/api';
import { isPaletteColour } from '@/lib/service-identity';
import { requireTenantAdmin } from '@/lib/auth';
import { DateTime } from 'luxon';
import { listTenantMembers } from '@/lib/db/console';
import { deletionBlockers, deletionKeeps, LIMIT_REACHED, nameConfirmed, withinServiceLimit } from '@/lib/service-deletion';
import { countActiveServices, loadDeletionFacts, loadLiveService } from '@/lib/service-deletion-server';
import { sendServiceDeletedEmail } from '@/lib/service-deletion-email';
import { serializeEventType } from '@/lib/admin-serializers';
import { parseBookingModeForUpdate, parseLocation, parsePrice } from '@/lib/admin-event-types';
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
 * calls this route with `{ active: false }` for what a tenant sees as
 * pausing a service, and `{ active: true }` to resume it.
 *
 * Deleting for good is the DELETE below, and it still removes no row: see
 * migration 0029 and src/lib/service-deletion.ts.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    /* A deleted service is gone for good: nothing about it can change. */
    const existing = await loadLiveService(scope, id);
    if (!existing) return fail('Not found', 404);

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
    if (active !== undefined) {
      /* Resuming counts against the allowance the same as adding does. */
      if (active && !existing.active && !withinServiceLimit(await countActiveServices(scope, id))) {
        return fail(LIMIT_REACHED, 409);
      }
      patch.active = active;
    }

    // One of the six, so every colour a service can have is one that has
    // been checked to carry white text — see service-identity.ts.
    const color = optionalString(body, 'color', { maxLength: 7 });
    if (color !== undefined) {
      if (!isPaletteColour(color)) return fail('Choose one of the colours offered', 400);
      patch.color = color.toLowerCase();
    }

    const priceMinor = parsePrice(body);
    if (priceMinor !== undefined) patch.price_minor = priceMinor;

    const location = parseLocation(body);
    if (location !== undefined) {
      patch.location_kind = location.locationKind;
      patch.location_detail = location.locationDetail;
    }

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

/**
 * Delete a service for good.
 *
 * Only a paused service that is empty — nothing still coming up, no paid
 * sessions still to book — and only with its name typed back. Nobody is
 * cancelled or emailed: there is nobody left to tell. The row stays, marked
 * deleted, so its past appointments keep the name they were booked under;
 * its own questions, which are settings rather than history, go. Whoever
 * deleted it gets an email saying so.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await ctx.params;
    const { tenant, scope, userId } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);
    const typed = typeof body.confirmName === 'string' ? body.confirmName : '';

    const service = await loadLiveService(scope, id);
    if (!service) return fail('Not found', 404);
    if (!nameConfirmed(typed, service.name)) {
      return fail(`Type “${service.name}” to delete it.`, 400);
    }

    const facts = await loadDeletionFacts(scope, service);
    const blockers = deletionBlockers(facts, tenant.timezone);
    if (blockers.length > 0) return fail(`It can’t be deleted yet. ${blockers.join(' ')}`, 409);

    const members = await listTenantMembers(tenant.id);
    const by = members.find((m) => m.userId === userId)?.email ?? null;

    const marked = await scope
      .update('event_types', {
        deleted_at: new Date().toISOString(),
        deleted_by: by,
        active: false,
        available_to_prospects: false,
        available_to_existing_clients: false,
      })
      .eq('id', id);
    if (marked.error) {
      if (/deleted_(at|by)/.test(marked.error.message)) {
        return fail('Deleting services needs database migration 0029 first.', 503);
      }
      throw marked.error;
    }

    const questions = await scope.delete('qualification_questions').eq('event_type_id', id);
    if (questions.error) throw questions.error;

    const email = by
      ? await sendServiceDeletedEmail({
          to: by,
          serviceName: service.name,
          tenantName: tenant.name,
          when: DateTime.now().setZone(tenant.timezone).toFormat("d LLLL yyyy 'at' HH:mm"),
          kept: deletionKeeps(facts),
        })
      : 'not_configured';

    return ok({ deleted: true, emailedTo: by, email });
  } catch (error) {
    return handleError(error);
  }
}
