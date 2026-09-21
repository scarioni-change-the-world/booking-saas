import { randomUUID } from 'node:crypto';
import { baseUrl } from './base-url';
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
import {
  sendBookingCancelledEmail,
  sendBookingConfirmedEmail,
  sendBookingPackConfirmedEmail,
  sendBookingRescheduledEmail,
} from './booking-email';
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

/**
 * Load one active event type belonging to this tenant, or throw.
 *
 * Exported so the qualification routes (.../questions, .../qualify/start)
 * can validate a prospect-supplied eventTypeId the same way booking
 * creation already does — a question set or a questionnaire response
 * scoped to a service the tenant doesn't have (or has archived) should
 * fail the same clear way an attempt to book it does.
 */
export async function loadEventType(scope: TenantScope, eventTypeId: string): Promise<EventTypeRow> {
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
  /** Set when a known, token-identified existing client is booking a
   * one-off (booking_mode 'single') session — see
   * /api/t/[slug]/client/[token]/single-session. Ties the booking to their
   * clients row the same way createEntitlementBookings already does for
   * package redemption, so their history and future package grants have
   * something to key off. Left unset (null) for a prospect, who has no
   * clients row at all. */
  clientId?: string | null;
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
    client_id: input.clientId ?? null,
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
  const synced = await syncBookingToCalendar(tenant, scope, booking, eventType);

  // After sync, not before: sending the confirmation with meeting_url only
  // once the calendar side of it actually exists (or has definitively
  // failed to) means the email a client receives never shows a stale
  // "no meeting link yet" for a booking that was synced a moment later.
  const emailStatus = await sendBookingConfirmedEmail(tenant, scope, synced);

  // The row in the database now carries this, written by the send itself —
  // but `synced` was read before that update, so it still holds 'pending'.
  // Returning the real outcome saves the caller a re-read, and is what lets
  // the confirmation screen say whether an email is actually coming.
  return { ...synced, email_status: emailStatus };
}

export interface CreateBookingPackInput extends Omit<CreateBookingInput, 'startsAt'> {
  /** Every appointment in the programme, as the client chose them. */
  slots: string[];
}

/**
 * Book a whole programme at once.
 *
 * The thing that makes this safe is that it is a *single* INSERT. Postgres
 * evaluates migration 0004's exclusion constraint across the statement, so
 * ten appointments either all land or none do — including the case where two
 * of the chosen times overlap each other, which the per-slot check below
 * cannot see because neither exists yet.
 *
 * Getting this wrong in the obvious way — a loop of ten inserts — would
 * leave a client holding six appointments of a ten-session programme they
 * thought they had bought, with no record that four failed. There is no
 * sensible recovery from that, so the design removes the possibility rather
 * than handling it.
 *
 * The per-slot availability check still runs first, for the same reason it
 * does for a single booking: it produces a useful error ("that time is no
 * longer available") where the constraint produces only a violation.
 *
 * Calendar sync and email happen after, per appointment for the calendar and
 * once for the pack — see the caller. Neither can undo the booking, and by
 * this point the programme genuinely exists.
 */
export async function createBookingPack(
  tenant: TenantRow,
  scope: TenantScope,
  input: CreateBookingPackInput,
): Promise<BookingRow[]> {
  const eventType = await loadEventType(scope, input.eventTypeId);

  if (eventType.booking_mode !== 'pack' || !eventType.pack_size) {
    throw new BookingError('That service is not booked as a pack', 400);
  }

  const slots = [...new Set(input.slots)].sort();
  if (slots.length !== eventType.pack_size) {
    throw new BookingError(
      `This programme is ${eventType.pack_size} appointments — please choose ${eventType.pack_size} times`,
      400,
    );
  }

  // One availability query per distinct day rather than per slot: a
  // ten-session programme usually spans ten days, but two sessions on one
  // day would otherwise cost two identical round trips.
  const days = [
    ...new Set(
      slots.map((iso) =>
        DateTime.fromISO(iso).setZone(tenant.timezone).toFormat('yyyy-MM-dd'),
      ),
    ),
  ].sort();

  for (const day of days) {
    const query = await buildSlotQuery(tenant, scope, input.eventTypeId, day, day);
    for (const iso of slots) {
      const onThisDay =
        DateTime.fromISO(iso).setZone(tenant.timezone).toFormat('yyyy-MM-dd') === day;
      if (onThisDay && !isSlotBookable(query, iso)) {
        throw new BookingError('One of those times is no longer available', 409);
      }
    }
  }

  const packId = randomUUID();
  const rows = slots.map((iso) => {
    const startsAt = DateTime.fromISO(iso, { zone: 'utc' });
    return {
      event_type_id: eventType.id,
      manage_token: generateManageToken(),
      starts_at: startsAt.toISO()!,
      ends_at: startsAt.plus({ minutes: eventType.duration_minutes }).toISO()!,
      name: input.name,
      email: input.email,
      notes: input.notes ?? null,
      qualification_response_id: input.qualificationResponseId ?? null,
      client_id: input.clientId ?? null,
      sync_status: 'pending' as const,
      pack_id: packId,
      // Copied, not referenced: what the client bought must not change when
      // the business later edits the service. See migration 0025.
      pack_size: eventType.pack_size,
    };
  });

  const { data, error } = await scope.insert('bookings', rows);

  if (error) {
    if (error.code === '23P01') {
      throw new BookingError('One of those times was just taken — please choose again', 409);
    }
    throw error;
  }

  const created = (data as unknown as BookingRow[]) ?? [];
  // Ordered by time, because every screen and email that follows reads them
  // as a programme running forwards.
  created.sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  // Each appointment gets its own calendar event: they are separate
  // commitments in a diary, and cancelling one must not disturb the rest.
  // Sequential rather than parallel, because ten simultaneous writes to one
  // Google calendar is how a tenant's quota gets spent on a single booking.
  const synced: BookingRow[] = [];
  for (const booking of created) {
    synced.push(await syncBookingToCalendar(tenant, scope, booking, eventType));
  }

  // One email for the whole programme, after sync, for the same reason a
  // single booking waits: the meeting links exist by now, or have
  // definitively failed to.
  const emailStatus = await sendBookingPackConfirmedEmail(tenant, scope, synced);

  return synced.map((booking) => ({ ...booking, email_status: emailStatus }));
}

export interface PackStanding {
  /** How many appointments the programme was sold as. */
  size: number;
  /** How many are currently held. */
  booked: number;
  /** How many the client is still owed — 0 when the programme is whole. */
  remaining: number;
  /** Every appointment in the programme, earliest first. */
  appointments: Array<{ startsAt: string; status: BookingRow['status'] }>;
}

/**
 * Where a programme stands.
 *
 * Derived on every read rather than kept in a column, and that is the whole
 * design: a "sessions remaining" counter would have to be decremented on
 * booking, incremented on cancel, left alone on reschedule, and corrected by
 * hand the first time any of those failed halfway. A count of confirmed rows
 * cannot drift from the confirmed rows.
 *
 * `remaining` is what a client is owed. It goes above zero the moment one of
 * their appointments is cancelled, which is exactly the hole this closes:
 * before, cancelling session two of three simply lost it.
 */
export async function packStanding(
  scope: TenantScope,
  packId: string,
): Promise<PackStanding | null> {
  const { data, error } = await scope
    .select('bookings', 'starts_at, status, pack_size')
    .eq('pack_id', packId)
    .order('starts_at', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<Pick<BookingRow, 'starts_at' | 'status' | 'pack_size'>>;
  if (rows.length === 0) return null;

  // Every row of a pack carries the same size, written once (migration 0025).
  const size = rows[0]!.pack_size ?? rows.length;
  const booked = rows.filter((row) => row.status === 'confirmed').length;

  return {
    size,
    booked,
    remaining: Math.max(0, size - booked),
    appointments: rows.map((row) => ({ startsAt: row.starts_at, status: row.status })),
  };
}

/**
 * Book one of the appointments a programme still owes.
 *
 * The credential is the manage token of any appointment in the same pack —
 * the caller resolves that before reaching here, so by this point "is this
 * the right person" is already answered. What this checks is the only thing
 * left: that the programme is genuinely short. Without it, somebody holding
 * a link to a three-session programme could book a fourth, a fifth, and a
 * sixth, for free.
 *
 * The new appointment joins the same pack rather than replacing the
 * cancelled row. The cancellation stays as history — it happened, it is on
 * the calendar's record of what was freed, and rewriting it would make the
 * programme's story unreadable later.
 */
export async function bookPackReplacement(
  tenant: TenantRow,
  scope: TenantScope,
  sibling: BookingRow,
  startsAt: string,
): Promise<BookingRow> {
  if (!sibling.pack_id || !sibling.pack_size) {
    throw new BookingError('That booking is not part of a programme', 400);
  }

  const standing = await packStanding(scope, sibling.pack_id);
  if (!standing || standing.remaining < 1) {
    throw new BookingError('Every appointment in this programme is already booked', 409);
  }

  const eventType = await loadEventType(scope, sibling.event_type_id);
  const query = await buildSlotQuery(
    tenant,
    scope,
    sibling.event_type_id,
    DateTime.fromISO(startsAt).setZone(tenant.timezone).toFormat('yyyy-MM-dd'),
    DateTime.fromISO(startsAt).setZone(tenant.timezone).toFormat('yyyy-MM-dd'),
  );

  if (!isSlotBookable(query, startsAt)) {
    throw new BookingError('That time is no longer available', 409);
  }

  const starts = DateTime.fromISO(startsAt, { zone: 'utc' });
  const { data, error } = await scope.insert('bookings', {
    event_type_id: sibling.event_type_id,
    manage_token: generateManageToken(),
    starts_at: starts.toISO()!,
    ends_at: starts.plus({ minutes: eventType.duration_minutes }).toISO()!,
    name: sibling.name,
    email: sibling.email,
    notes: sibling.notes,
    qualification_response_id: sibling.qualification_response_id,
    client_id: sibling.client_id,
    sync_status: 'pending',
    pack_id: sibling.pack_id,
    pack_size: sibling.pack_size,
  });

  if (error) {
    if (error.code === '23P01') throw new BookingError('That time was just taken', 409);
    throw error;
  }

  const booking = (data as unknown as BookingRow[])[0]!;
  const synced = await syncBookingToCalendar(tenant, scope, booking, eventType);

  // The ordinary single-booking confirmation, not the pack one: this is one
  // appointment being added back, and an email listing the whole programme
  // again would read as though everything had been rebooked.
  const emailStatus = await sendBookingConfirmedEmail(tenant, scope, synced);

  return { ...synced, email_status: emailStatus };
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

  /* A cancelled appointment inside a programme is one the client is still
     owed, so the email carries the way to book it back. Worked out here
     because packStanding lives in this module; the email module cannot
     reach it without a cycle. Best effort — the cancellation has already
     happened and must not fail over a count. */
  let replacementLink: string | undefined;
  if (booking.pack_id) {
    try {
      const standing = await packStanding(scope, booking.pack_id);
      if (standing && standing.remaining > 0) {
        replacementLink = `${baseUrl()}/manage/${encodeURIComponent(booking.manage_token)}`;
      }
    } catch (cause) {
      console.error('[packs] could not work out what a cancellation left owing:', cause);
    }
  }

  await sendBookingCancelledEmail(tenant, scope, booking, replacementLink);
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

  let moved: BookingRow = { ...booking, starts_at: startsAt.toISO()!, ends_at: endsAt.toISO()! };

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
      moved = { ...moved, sync_status: 'failed' };
    }
  }

  // Sent either way — the new time is confirmed to the client regardless of
  // whether the calendar side of the reschedule succeeded.
  await sendBookingRescheduledEmail(tenant, scope, moved);

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
    // Same as createBooking: after sync, not before, so meeting_url is only
    // ever included once it actually exists (or has definitively failed to).
    // Missing from here previously — a redeemed package session never sent
    // a confirmation at all, unlike every other kind of booking.
    const emailStatus = await sendBookingConfirmedEmail(tenant, scope, synced);
    results.push({ startsAt, status: 'booked', booking: { ...synced, email_status: emailStatus } });
  }

  return { results, remaining: entitlement.total_sessions - used };
}
