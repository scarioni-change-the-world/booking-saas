import { DateTime } from 'luxon';
import { serializeAvailabilityRule, serializeDateOverride } from './admin-serializers';
import { windowsForDate } from './availability';
import { parseTimeToMinutes } from './blocked-slots';
import type { TenantScope } from './db';
import type { AvailabilityRuleRow, DateOverrideRow, EventTypeRow, TenantRow } from './db/types';
import type { AnswerSnapshot } from './reconsideration';
import { datesIn, rangeBounds, type DateRange } from './report-period';
import type {
  OpenDay,
  ReportBooking,
  ReportInput,
  ReportPayment,
  ReportRating,
  ReportResponse,
  ReportVisit,
} from './reports';

/**
 * Loading a report's rows. Kept apart from the model (reports.ts, pure) and
 * the route, because it is the part that must survive a database without
 * migration 0033: a column or table that is not there yet reads as "not
 * collected yet", never as an error.
 */

const PAGE = 1000;
const MAX_ROWS = 50_000;

const missing = (error: { code?: string; message?: string } | null) =>
  !!error && ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error.code ?? '');

/** Every row a query returns, past PostgREST's page size, up to MAX_ROWS. */
async function all<T>(
  run: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
): Promise<{ rows: T[]; missing: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) {
      if (missing(error)) return { rows: [], missing: true };
      throw error;
    }
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return { rows, missing: false };
}

const BASE_BOOKING_COLUMNS =
  'id, created_at, starts_at, ends_at, status, cancelled_at, cancellation_reason, event_type_id, email, name, pack_id, pack_size, entitlement_id, client_id';
const REPORT_BOOKING_COLUMNS = `${BASE_BOOKING_COLUMNS}, payment_id, source, attendance, cancelled_by, reschedule_count`;

interface BookingJoin {
  id: string;
  created_at: string;
  starts_at: string;
  ends_at: string;
  status: 'confirmed' | 'cancelled';
  cancelled_at: string | null;
  cancellation_reason: string | null;
  event_type_id: string;
  email: string;
  name: string;
  pack_id: string | null;
  pack_size: number | null;
  entitlement_id: string | null;
  client_id: string | null;
  payment_id?: string | null;
  source?: string | null;
  attendance?: 'attended' | 'no_show' | null;
  cancelled_by?: 'client' | 'business' | null;
  reschedule_count?: number | null;
}

async function loadBookings(scope: TenantScope, before: number): Promise<ReportBooking[]> {
  const beforeIso = new Date(before).toISOString();
  const query = (columns: string) => (from: number, to: number) =>
    scope
      .select('bookings', columns)
      .lt('created_at', beforeIso)
      .order('created_at', { ascending: true })
      .range(from, to);
  let result = await all<BookingJoin>(query(REPORT_BOOKING_COLUMNS));
  if (result.missing) result = await all<BookingJoin>(query(BASE_BOOKING_COLUMNS));
  return result.rows.map((b) => ({
    id: b.id,
    createdAt: b.created_at,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    status: b.status,
    cancelledAt: b.cancelled_at,
    cancelledBy: b.cancelled_by ?? null,
    cancellationReason: b.cancellation_reason,
    eventTypeId: b.event_type_id,
    email: b.email,
    name: b.name,
    packId: b.pack_id,
    packSize: b.pack_size,
    source: b.source ?? null,
    attendance: b.attendance ?? null,
    rescheduleCount: b.reschedule_count ?? 0,
    paymentId: b.payment_id ?? null,
    // Redeeming a package is always done from the client's own link.
    viaClientLink: b.source === 'client_link' || !!b.entitlement_id,
  }));
}

async function openDaysFor(scope: TenantScope, range: DateRange): Promise<OpenDay[]> {
  const [rulesResult, overridesResult] = await Promise.all([
    scope.select('availability_rules'),
    scope.select('date_overrides').gte('date', range.from).lte('date', range.to),
  ]);
  if (rulesResult.error) throw rulesResult.error;
  if (overridesResult.error) throw overridesResult.error;
  const rules = ((rulesResult.data ?? []) as unknown as AvailabilityRuleRow[]).map(serializeAvailabilityRule);
  const overrides = ((overridesResult.data ?? []) as unknown as DateOverrideRow[]).map(serializeDateOverride);
  const overrideMap = new Map(overrides.map((o) => [o.date, o]));
  return datesIn(range).map((date) => {
    const day = DateTime.fromISO(date);
    return {
      date,
      weekday: day.weekday,
      windows: windowsForDate(day, rules, overrideMap)
        .map((w) => ({
          startMinutes: parseTimeToMinutes(w.startTime),
          endMinutes: parseTimeToMinutes(w.endTime),
        }))
        .filter((w) => w.endMinutes > w.startMinutes),
    };
  });
}

export interface LoadedReport {
  input: ReportInput;
  currency: string;
  /** The first day visits were counted, or null before any were. */
  visitsSince: string | null;
}

export async function loadReportInput(
  tenant: TenantRow,
  scope: TenantScope,
  period: DateRange,
  previous: DateRange,
): Promise<LoadedReport> {
  const tz = tenant.timezone;
  const cur = rangeBounds(period, tz);
  const prev = rangeBounds(previous, tz);
  const since = new Date(prev.start).toISOString();
  const until = new Date(cur.end).toISOString();

  const [
    settings,
    services,
    bookings,
    responses,
    visits,
    firstVisit,
    payments,
    ratings,
    openDays,
    previousOpenDays,
  ] = await Promise.all([
    scope.select('tenant_settings').maybeSingle(),
    scope.select('event_types', 'id, name, price_minor, duration_minutes, booking_mode, pack_size'),
    // Up to the end of the period plus 90 days: later bookings are how
    // "came back" and "booked ahead" are known.
    loadBookings(scope, Math.max(cur.end, Date.now()) + 90 * 24 * 3600 * 1000),
    all<{
      started_at: string;
      completed_at: string | null;
      event_type_id: string | null;
      outcome_path_type: 'meeting' | 'other' | null;
      answers: unknown;
    }>((from, to) =>
      scope
        .select(
          'qualification_responses',
          'started_at, completed_at, event_type_id, outcome_path_type, answers',
        )
        .gte('started_at', since)
        .lt('started_at', until)
        .range(from, to),
    ),
    all<{ visited_at: string; source: string; surface: ReportVisit['surface'] }>((from, to) =>
      scope
        .select('page_visits', 'visited_at, source, surface')
        .gte('visited_at', since)
        .lt('visited_at', until)
        .range(from, to),
    ),
    scope.select('page_visits', 'visited_at').order('visited_at', { ascending: true }).limit(1),
    all<{
      id: string;
      status: ReportPayment['status'];
      amount_minor: number;
      refunded_minor: number;
      paid_at: string | null;
      payment_mode: 'full' | 'deposit';
      kind: 'single' | 'pack';
      event_type_id: string | null;
    }>((from, to) =>
      scope
        .select(
          'payments',
          'id, status, amount_minor, refunded_minor, paid_at, payment_mode, kind, event_type_id',
        )
        .in('status', ['paid', 'refunded'])
        .range(from, to),
    ),
    all<{ booking_id: string; rating: number; comment: string | null; created_at: string }>((from, to) =>
      scope
        .select('session_ratings', 'booking_id, rating, comment, created_at')
        .gte('created_at', since)
        .lt('created_at', until)
        .range(from, to),
    ),
    openDaysFor(scope, period),
    openDaysFor(scope, previous),
  ]);

  if (settings.error) throw settings.error;
  if (services.error) throw services.error;
  const s = settings.data as unknown as { booking_notice_hours?: number; currency?: string } | null;
  const first = firstVisit.error
    ? null
    : ((firstVisit.data ?? []) as unknown as Array<{ visited_at: string }>)[0];
  const visitsSince = first ? DateTime.fromISO(first.visited_at, { zone: tz }).toISODate() : null;

  const input: ReportInput = {
    timezone: tz,
    now: new Date().toISOString(),
    period,
    previous,
    noticeHours: s?.booking_notice_hours ?? 24,
    services: (
      (services.data ?? []) as unknown as Array<
        Pick<EventTypeRow, 'id' | 'name' | 'price_minor' | 'duration_minutes' | 'booking_mode' | 'pack_size'>
      >
    ).map((e) => ({
      id: e.id,
      name: e.name,
      priceMinor: e.price_minor,
      durationMinutes: e.duration_minutes,
      bookingMode: e.booking_mode,
      packSize: e.pack_size,
    })),
    bookings,
    responses: responses.rows.map(
      (r): ReportResponse => ({
        createdAt: r.started_at,
        completedAt: r.completed_at,
        eventTypeId: r.event_type_id,
        outcomePathType: r.outcome_path_type,
        answers: Array.isArray(r.answers) ? (r.answers as AnswerSnapshot[]) : [],
      }),
    ),
    visits: visits.rows.map((v) => ({ visitedAt: v.visited_at, source: v.source, surface: v.surface })),
    payments: payments.rows.map((p) => ({
      id: p.id,
      status: p.status,
      amountMinor: p.amount_minor,
      refundedMinor: p.refunded_minor,
      paidAt: p.paid_at,
      paymentMode: p.payment_mode,
      kind: p.kind,
      eventTypeId: p.event_type_id,
    })),
    ratings: ratings.rows.map(
      (r): ReportRating => ({
        bookingId: r.booking_id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.created_at,
      }),
    ),
    openDays,
    previousOpenDays,
    // Only once counting began before this period ended — a report of a
    // month with no counter would otherwise say nobody visited.
    visitsTracked: !visits.missing && !!visitsSince && visitsSince <= period.to,
  };
  return { input, currency: (s?.currency ?? 'EUR').toUpperCase(), visitsSince };
}
