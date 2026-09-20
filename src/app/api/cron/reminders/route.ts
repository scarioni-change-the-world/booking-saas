import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';
import { handleError, ok } from '@/lib/api';
import { cronSecretConfigured, isScheduledRequest } from '@/lib/cron-auth';
import { sendBookingReminderEmail } from '@/lib/booking-email';
import { bookingsDueAReminder, claimReminder, tenantScope } from '@/lib/db';
import type { BookingRow, TenantRow } from '@/lib/db/types';
import { __unsafeServiceClient } from '@/lib/db/client';

/**
 * Send tomorrow's reminders.
 *
 * A public URL that sends real mail on demand, which makes the shared
 * secret the entire security boundary. Three rules follow from that:
 *
 *   - No secret configured means no endpoint. It answers 503 rather than
 *     running, because an unset environment variable must never be the
 *     thing that makes a door open. An empty-string comparison would
 *     otherwise let anyone in.
 *   - The comparison is length-checked first and then byte-by-byte without
 *     early exit, so response time carries no information about how much of
 *     a guessed secret was right.
 *   - Failure says nothing. Same 401, same shape, whether the header was
 *     absent, malformed or wrong.
 *
 * Vercel's scheduler sends `authorization: Bearer <CRON_SECRET>`; the same
 * header works for a manual run with curl, which is how this gets tested.
 */

const WINDOW_START_HOURS = 2;
const WINDOW_END_HOURS = 26;
const MAX_PER_RUN = 200;

/** Tenants are looked up once per run, not once per booking. */
async function tenantLoader() {
  const cache = new Map<string, TenantRow | null>();

  return async function load(tenantId: string): Promise<TenantRow | null> {
    if (cache.has(tenantId)) return cache.get(tenantId)!;

    const { data, error } = await __unsafeServiceClient()
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .maybeSingle();
    if (error) throw error;

    const tenant = (data as TenantRow | null) ?? null;
    cache.set(tenantId, tenant);
    return tenant;
  };
}

export async function GET(request: Request) {
  if (!cronSecretConfigured()) {
    // Said plainly, because the person who sees this is whoever just set the
    // schedule up and is wondering why nothing happens.
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured, so this endpoint is disabled.' },
      { status: 503 },
    );
  }
  if (!isScheduledRequest(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  try {
    const now = DateTime.utc();
    const due = await bookingsDueAReminder(
      now.plus({ hours: WINDOW_START_HOURS }).toISO()!,
      now.plus({ hours: WINDOW_END_HOURS }).toISO()!,
      MAX_PER_RUN,
    );

    const loadTenant = await tenantLoader();
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const booking of due as BookingRow[]) {
      // Claimed before sending. A duplicate reminder is the failure people
      // notice and complain about; a missing one is invisible. See
      // claimReminder for the whole argument.
      if (!(await claimReminder(booking.id))) {
        skipped += 1;
        continue;
      }

      const tenant = await loadTenant(booking.tenant_id);
      if (!tenant) {
        failed += 1;
        continue;
      }

      try {
        // Deliberately not gated on the tenant's billing state. The person
        // receiving this booked an appointment in good faith and is not the
        // one who owes anybody money; letting them turn up to nothing
        // because their physiotherapist's trial lapsed would punish the
        // wrong person.
        const status = await sendBookingReminderEmail(tenant, tenantScope(tenant.id), booking);
        if (status === 'sent') sent += 1;
        else failed += 1;
      } catch (cause) {
        console.error('[cron:reminders] send failed for', booking.id, cause);
        failed += 1;
      }
    }

    console.log(
      `[cron:reminders] ${due.length} due · ${sent} sent · ${skipped} already claimed · ${failed} failed`,
    );
    return ok({ due: due.length, sent, skipped, failed });
  } catch (error) {
    return handleError(error);
  }
}

// Reminders are sent, not cached.
export const dynamic = 'force-dynamic';
