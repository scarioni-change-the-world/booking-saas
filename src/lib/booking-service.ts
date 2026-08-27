import { DateTime } from 'luxon';
import {
  generateSlots,
  isSlotBookable,
  type AvailabilityRule,
  type BusyInterval,
  type DateOverride,
  type DaySlots,
  type SlotQuery,
} from './availability';
import { providerForTenant, CalendarUnavailableError } from './calendar';
import type { TenantScope } from './db';
import type {
  AvailabilityRuleRow,
  BlockedSlotRow,
  BookingRow,
  ClientEntitlementRow,
  ClientRow,
  DateOverrideRow,
  EventTypeRow,
  TenantRow,
  TenantSettingsRow,
} from './db/types';
import { generateManageToken } from './tokens';

export type Audience = 'prospect' | 'client';

export class BookingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BookingError';
  }
}

/**
 * Event types visible to one audience.
 *
 * The two flags are independent booleans, not opposites (brief 2.1) — a type
 * may be visible to both audiences, either, or neither — so this filters on the
 * one flag that matches, never on the negation of the other.
 */
export async function listEventTypes(
  scope: TenantScope,
  audience: Audience,
): Promise<EventTypeRow[]> {
  const column =
    audience === 'prospect' ? 'available_to_prospects' : 'available_to_existing_clients';

  const { data, error } = await scope
    .select('event_types')
    .eq('active', true)
    .eq(column, true)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as EventTypeRow[];
}

async function loadSettings(scope: TenantScope): Promise<TenantSettingsRow> {
  const { data, error } = await scope.select('tenant_settings').maybeSingle();
  if (error) throw error;
  if (!data) throw new BookingError('Tenant is not configured', 500);
  return data as unknown as TenantSettingsRow;
}

async function loadEventType(scope: TenantScope, eventTypeId: string): Promise<EventTypeRow> {
  const { data, error } = await scope
    .select('event_types')
    .eq('id', eventTypeId)
    .eq('active', true)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new BookingError('Unknown event type', 404);
  return data as unknown as EventTypeRow;
}

/**
 * Assemble everything the slot engine needs for one tenant and event type.
 *
 * Busy intervals are the union of confirmed bookings, ad-hoc blocks and the
 * external calendar (brief 5). If the calendar is connected but unreachable
 * this throws rather than returning a short busy list: brief 6.8 is explicit
 * that continuing to serve unchecked times is worse than refusing, because the
 * result is a double-booking the tenant only discovers on the day.
 */
export async function buildSlotQuery(
  tenant: TenantRow,
  scope: TenantScope,
  eventTypeId: string,
  fromDate: string,
  toDate: string,
): Promise<SlotQuery> {
  const [settings, eventType] = await Promise.all([
    loadSettings(scope),
    loadEventType(scope, eventTypeId),
  ]);

  const rangeStart = DateTime.fromISO(fromDate, { zone: tenant.timezone }).startOf('day');
  const rangeEnd = DateTime.fromISO(toDate, { zone: tenant.timezone }).endOf('day');

  if (!rangeStart.isValid || !rangeEnd.isValid || rangeEnd < rangeStart) {
    throw new BookingError('Invalid date range', 400);
  }

  const [rulesResult, overridesResult, blocksResult, bookingsResult] = await Promise.all([
    scope.select('availability_rules'),
    scope
      .select('date_overrides')
      .gte('date', rangeStart.toFormat('yyyy-MM-dd'))
      .lte('date', rangeEnd.toFormat('yyyy-MM-dd')),
    scope
      .select('blocked_slots')
      .lt('starts_at', rangeEnd.toISO()!)
      .gt('ends_at', rangeStart.toISO()!),
    scope
      .select('bookings')
      .eq('status', 'confirmed')
      .lt('starts_at', rangeEnd.toISO()!)
      .gt('ends_at', rangeStart.toISO()!),
  ]);

  for (const result of [rulesResult, overridesResult, blocksResult, bookingsResult]) {
    if (result.error) throw result.error;
  }

  const rules = (rulesResult.data ?? []) as unknown as AvailabilityRuleRow[];
  const overrides = (overridesResult.data ?? []) as unknown as DateOverrideRow[];
  const blocks = (blocksResult.data ?? []) as unknown as BlockedSlotRow[];
  const bookings = (bookingsResult.data ?? []) as unknown as BookingRow[];

  const provider = await providerForTenant(tenant.id);
  let calendarBusy: BusyInterval[] = [];
  try {
    calendarBusy = await provider.getBusy({
      from: rangeStart.toISO()!,
      to: rangeEnd.toISO()!,
      timezone: tenant.timezone,
    });
  } catch (cause) {
    // Fail closed. See the note above and brief 6.8.
    throw new CalendarUnavailableError(
      `Calendar unavailable for tenant ${tenant.slug}: ${(cause as Error).message}`,
      provider.id,
    );
  }

  const availabilityRules: AvailabilityRule[] = rules.map((r) => ({
    weekday: r.weekday,
    startTime: r.start_time,
    endTime: r.end_time,
  }));

  const dateOverrides: DateOverride[] = overrides.map((o) => ({
    date: o.date,
    isClosed: o.is_closed,
    startTime: o.start_time,
    endTime: o.end_time,
  }));

  const busy: BusyInterval[] = [
    ...bookings.map((b) => ({ start: b.starts_at, end: b.ends_at })),
    ...blocks.map((b) => ({ start: b.starts_at, end: b.ends_at })),
    ...calendarBusy,
  ];

  return {
    timezone: tenant.timezone,
    fromDate: rangeStart.toFormat('yyyy-MM-dd'),
    toDate: rangeEnd.toFormat('yyyy-MM-dd'),
    eventType: {
      durationMinutes: eventType.duration_minutes,
      bufferBeforeMinutes: eventType.buffer_before_minutes,
      bufferAfterMinutes: eventType.buffer_after_minutes,
    },
    availabilityRules,
    dateOverrides,
    busy,
    noticeHours: settings.booking_notice_hours,
    bookingWindowDays: settings.booking_window_days,
    now: DateTime.now(),
  };
}

export async function getAvailability(
  tenant: TenantRow,
  scope: TenantScope,
  eventTypeId: string,
  fromDate: string,
  toDate: string,
): Promise<DaySlots[]> {
  const query = await buildSlotQuery(tenant, scope, eventTypeId, fromDate, toDate);
  return generateSlots(query);
}

export interface CreateBookingInput {
  eventTypeId: string;
  startsAt: string;
  name: string;
  email: string;
  notes?: string;
  qualificationResponseId?: string | null;
}

/**
 * Write a booking.
 *
 * The submitted slot is re-validated against a freshly built query rather than
 * trusted: the list it came from may be minutes stale, and nothing stops a
 * caller posting an arbitrary instant straight at this endpoint.
 *
 * Calendar sync is attempted after the row exists and its outcome is recorded
 * on the row. The reference implementation wrapped this in a try/catch so a
 * booking still succeeded when Google failed — right behaviour, but it left no
 * trace, which is what made a dead integration invisible for so long
 * (brief 6.9). Here a failure lands in sync_status and sync_error.
 */
export async function createBooking(
  tenant: TenantRow,
  scope: TenantScope,
  input: CreateBookingInput,
): Promise<BookingRow> {
  const eventType = await loadEventType(scope, input.eventTypeId);

  const query = await buildSlotQuery(
    tenant,
    scope,
    input.eventTypeId,
    DateTime.fromISO(input.startsAt).setZone(tenant.timezone).toFormat('yyyy-MM-dd'),
    DateTime.fromISO(input.startsAt).setZone(tenant.timezone).toFormat('yyyy-MM-dd'),
  );

  if (!isSlotBookable(query, input.startsAt)) {
    throw new BookingError('That time is no longer available', 409);
  }

  const startsAt = DateTime.fromISO(input.startsAt, { zone: 'utc' });
  const endsAt = startsAt.plus({ minutes: eventType.duration_minutes });

  const { data, error } = await scope.insert('bookings', {
    event_type_id: eventType.id,
    manage_token: generateManageToken(),
    starts_at: startsAt.toISO()!,
    ends_at: endsAt.toISO()!,
    name: input.name,
    email: input.email,
    notes: input.notes ?? null,
    qualification_response_id: input.qualificationResponseId ?? null,
    sync_status: 'pending',
  });

  if (error) {
    // The exclusion constraint in migration 0004 is the last line of defence
    // against two requests racing past the availability check.
    if (error.code === '23P01') {
      throw new BookingError('That time was just taken', 409);
    }
    throw error;
  }

  const booking = (data as unknown as BookingRow[])[0]!;
  return syncBookingToCalendar(tenant, scope, booking, eventType);
}

/** Create the calendar event and record the outcome — success or failure. */
async function syncBookingToCalendar(
  tenant: TenantRow,
  scope: TenantScope,
  booking: BookingRow,
  eventType: EventTypeRow,
): Promise<BookingRow> {
  const provider = await providerForTenant(tenant.id);

  if (provider.id === 'none') {
    await scope.update('bookings', { sync_status: 'not_configured' }).eq('id', booking.id);
    return { ...booking, sync_status: 'not_configured' };
  }

  try {
    const event = await provider.createEvent({
      summary: `${eventType.name} — ${booking.name}`,
      description: booking.notes ?? undefined,
      start: booking.starts_at,
      end: booking.ends_at,
      timezone: tenant.timezone,
      attendeeEmail: booking.email,
      attendeeName: booking.name,
      createConference: true,
    });

    await scope
      .update('bookings', {
        calendar_event_id: event.eventId,
        meeting_url: event.meetingUrl,
        sync_status: 'synced',
        sync_error: null,
      })
      .eq('id', booking.id);

    return {
      ...booking,
      calendar_event_id: event.eventId,
      meeting_url: event.meetingUrl,
      sync_status: 'synced',
    };
  } catch (cause) {
    const message = (cause as Error).message.slice(0, 500);
    await scope
      .update('bookings', { sync_status: 'failed', sync_error: message })
      .eq('id', booking.id);

    return { ...booking, sync_status: 'failed', sync_error: message };
  }
}

/** Cancel a booking. Frees the slot and removes the calendar event (brief 2.4). */
export async function cancelBooking(
  tenant: TenantRow,
  scope: TenantScope,
  booking: BookingRow,
  reason?: string,
): Promise<void> {
  if (booking.status === 'cancelled') return;

  const { error } = await scope
    .update('bookings', {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason ?? null,
    })
    .eq('id', booking.id);

  if (error) throw error;

  // Hand the session back if this booking drew down a package — a cancelled
  // visit shouldn't cost the client one of their paid-for sessions. Best
  // effort and never blocking: same posture as the calendar cleanup below,
  // for the same reason — the cancellation itself must always succeed.
  if (booking.entitlement_id) {
    try {
      const { data, error: entError } = await scope
        .select('client_entitlements')
        .eq('id', booking.entitlement_id)
        .maybeSingle();
      if (entError) throw entError;

      const entitlement = data as unknown as ClientEntitlementRow | null;
      if (entitlement) {
        await scope
          .update('client_entitlements', {
            used_sessions: Math.max(0, entitlement.used_sessions - 1),
            updated_at: new Date().toISOString(),
          })
          .eq('id', entitlement.id);
      }
    } catch (cause) {
      console.error('[clients] could not restore an entitlement session on cancel:', cause);
    }
  }

  if (booking.calendar_event_id) {
    try {
      // Inside the try: resolving the provider throws when the connection is
      // broken, and a cancellation must never fail because of that. The client
      // asked to cancel and the slot is already free.
      const provider = await providerForTenant(tenant.id);
      await provider.deleteEvent(booking.calendar_event_id);
    } catch (cause) {
      // The booking is cancelled either way; the orphaned event is recorded so
      // the dashboard can show it rather than it vanishing into a log.
      await scope
        .update('bookings', {
          sync_status: 'failed',
          sync_error: `Cancel: ${(cause as Error).message}`.slice(0, 500),
        })
        .eq('id', booking.id);
    }
  }
}

/**
 * Move a booking to a new time.
 *
 * Runs the same availability rules as a fresh booking, excluding the booking's
 * own current slot — otherwise a booking would always be found to conflict with
 * itself and no reschedule could ever succeed.
 */
export async function rescheduleBooking(
  tenant: TenantRow,
  scope: TenantScope,
  booking: BookingRow,
  newStartIso: string,
): Promise<BookingRow> {
  if (booking.status === 'cancelled') {
    throw new BookingError('That booking was cancelled', 409);
  }

  const eventType = await loadEventType(scope, booking.event_type_id);
  const localDate = DateTime.fromISO(newStartIso).setZone(tenant.timezone).toFormat('yyyy-MM-dd');

  const query = await buildSlotQuery(tenant, scope, booking.event_type_id, localDate, localDate);
  const withoutSelf: SlotQuery = {
    ...query,
    busy: query.busy.filter(
      (b) => !(b.start === booking.starts_at && b.end === booking.ends_at),
    ),
  };

  if (!isSlotBookable(withoutSelf, newStartIso)) {
    throw new BookingError('That time is not available', 409);
  }

  const startsAt = DateTime.fromISO(newStartIso, { zone: 'utc' });
  const endsAt = startsAt.plus({ minutes: eventType.duration_minutes });

  const { error } = await scope
    .update('bookings', { starts_at: startsAt.toISO()!, ends_at: endsAt.toISO()! })
    .eq('id', booking.id);

  if (error) {
    if (error.code === '23P01') throw new BookingError('That time was just taken', 409);
    throw error;
  }

  const moved: BookingRow = { ...booking, starts_at: startsAt.toISO()!, ends_at: endsAt.toISO()! };

  if (booking.calendar_event_id) {
    try {
      const provider = await providerForTenant(tenant.id);
      await provider.updateEvent(booking.calendar_event_id, {
        summary: `${eventType.name} — ${booking.name}`,
        description: booking.notes ?? undefined,
        start: moved.starts_at,
        end: moved.ends_at,
        timezone: tenant.timezone,
        attendeeEmail: booking.email,
        attendeeName: booking.name,
      });
    } catch (cause) {
      await scope
        .update('bookings', {
          sync_status: 'failed',
          sync_error: `Reschedule: ${(cause as Error).message}`.slice(0, 500),
        })
        .eq('id', booking.id);
      return { ...moved, sync_status: 'failed' };
    }
  }

  return moved;
}

/**
 * Package entitlements — a client who has bought N sessions of one session
 * type may book several of them in one visit instead of coming back N
 * separate times.
 */

/** Resolve the client behind a private booking link — same token-is-the-
 * credential shape as a booking's own manage token. */
export async function resolveClientByToken(
  scope: TenantScope,
  token: string,
): Promise<ClientRow | null> {
  if (!token || token.length < 20) return null;

  const { data, error } = await scope.select('clients').eq('access_token', token).maybeSingle();
  if (error) throw error;
  return data as unknown as ClientRow | null;
}

export interface ClientEntitlementSummary {
  id: string;
  eventTypeId: string;
  eventTypeName: string;
  durationMinutes: number;
  totalSessions: number;
  usedSessions: number;
  remaining: number;
}

/** A client's own balances, one row per session type they've been granted. */
export async function listClientEntitlements(
  scope: TenantScope,
  clientId: string,
): Promise<ClientEntitlementSummary[]> {
  const { data, error } = await scope
    .select('client_entitlements', '*, event_types(name, duration_minutes)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<
    ClientEntitlementRow & { event_types: { name: string; duration_minutes: number } | null }
  >;

  return rows.map((r) => ({
    id: r.id,
    eventTypeId: r.event_type_id,
    eventTypeName: r.event_types?.name ?? 'Unknown session type',
    durationMinutes: r.event_types?.duration_minutes ?? 0,
    totalSessions: r.total_sessions,
    usedSessions: r.used_sessions,
    remaining: r.total_sessions - r.used_sessions,
  }));
}

/**
 * Grant or top up a package. One entitlement per (client, event type) — see
 * migration 0010 — so adding sessions to an existing grant raises its total
 * rather than creating a second, parallel one that the balance would have to
 * be added up across.
 */
export async function grantEntitlement(
  scope: TenantScope,
  clientId: string,
  eventTypeId: string,
  sessions: number,
): Promise<ClientEntitlementRow> {
  const { data: existing, error: findError } = await scope
    .select('client_entitlements')
    .eq('client_id', clientId)
    .eq('event_type_id', eventTypeId)
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const row = existing as unknown as ClientEntitlementRow;
    const { data, error } = await scope
      .update('client_entitlements', {
        total_sessions: row.total_sessions + sessions,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .select();
    if (error) throw error;
    return (data as unknown as ClientEntitlementRow[])[0]!;
  }

  const { data, error } = await scope.insert('client_entitlements', {
    client_id: clientId,
    event_type_id: eventTypeId,
    total_sessions: sessions,
  });
  if (error) throw error;
  return (data as unknown as ClientEntitlementRow[])[0]!;
}

async function loadEntitlement(
  scope: TenantScope,
  entitlementId: string,
): Promise<ClientEntitlementRow> {
  const { data, error } = await scope
    .select('client_entitlements')
    .eq('id', entitlementId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new BookingError('Unknown package', 404);
  return data as unknown as ClientEntitlementRow;
}

export interface EntitlementBookingResult {
  startsAt: string;
  status: 'booked' | 'unavailable' | 'no_sessions_left';
  booking?: BookingRow;
}

/**
 * Book several sessions against one package in a single visit.
 *
 * Deliberately not all-or-nothing: a slot going stale between the client
 * picking it and this running is a normal, expected race (the whole batch
 * was likely built from a calendar view that is a few seconds old by
 * submit), not a reason to discard the rest of a selection that is still
 * good. Each start time is independently re-validated and either booked or
 * reported as unavailable, and the caller decides what to do with a partial
 * result — this never pretends a booking happened when it didn't.
 *
 * Sessions are debited one at a time, immediately after each booking is
 * written, rather than once at the end — so the very next iteration (and any
 * other request racing against the same package) sees an accurate remaining
 * count. If the debit itself is ever refused — the check constraint in
 * migration 0010 catching a genuine race with another request — the booking
 * that triggered it is removed rather than left standing on a session that
 * was never actually paid down.
 */
export async function createEntitlementBookings(
  tenant: TenantRow,
  scope: TenantScope,
  entitlementId: string,
  client: ClientRow,
  startTimes: string[],
): Promise<{ results: EntitlementBookingResult[]; remaining: number }> {
  const entitlement = await loadEntitlement(scope, entitlementId);
  if (entitlement.client_id !== client.id) {
    throw new BookingError('That package does not belong to this client', 403);
  }

  const eventType = await loadEventType(scope, entitlement.event_type_id);

  const results: EntitlementBookingResult[] = [];
  let used = entitlement.used_sessions;

  for (const startsAt of startTimes) {
    if (used >= entitlement.total_sessions) {
      results.push({ startsAt, status: 'no_sessions_left' });
      continue;
    }

    const localDate = DateTime.fromISO(startsAt).setZone(tenant.timezone).toFormat('yyyy-MM-dd');
    const query = await buildSlotQuery(tenant, scope, eventType.id, localDate, localDate);

    if (!isSlotBookable(query, startsAt)) {
      results.push({ startsAt, status: 'unavailable' });
      continue;
    }

    const start = DateTime.fromISO(startsAt, { zone: 'utc' });
    const end = start.plus({ minutes: eventType.duration_minutes });

    const { data, error } = await scope.insert('bookings', {
      event_type_id: eventType.id,
      manage_token: generateManageToken(),
      starts_at: start.toISO()!,
      ends_at: end.toISO()!,
      name: client.name,
      email: client.email,
      notes: null,
      client_id: client.id,
      entitlement_id: entitlement.id,
      sync_status: 'pending',
    });

    if (error) {
      // 23P01 = the exclusion constraint (migration 0004) — someone else
      // took this exact time between our check above and this insert.
      if (error.code === '23P01') {
        results.push({ startsAt, status: 'unavailable' });
        continue;
      }
      throw error;
    }

    const booking = (data as unknown as BookingRow[])[0]!;

    const { error: debitError } = await scope
      .update('client_entitlements', {
        used_sessions: used + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entitlement.id);

    if (debitError) {
      await scope.delete('bookings').eq('id', booking.id);
      results.push({ startsAt, status: 'no_sessions_left' });
      continue;
    }

    used += 1;
    const synced = await syncBookingToCalendar(tenant, scope, booking, eventType);
    results.push({ startsAt, status: 'booked', booking: synced });
  }

  return { results, remaining: entitlement.total_sessions - used };
}
