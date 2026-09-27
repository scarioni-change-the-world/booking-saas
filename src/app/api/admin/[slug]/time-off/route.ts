import { DateTime } from 'luxon';
import { fail, handleError, ok, optionalBoolean, optionalString, readJson, requireDate } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import type { TenantScope } from '@/lib/db';
import type { DateOverrideRow } from '@/lib/db/types';
import { closedRuns, datesBetween, timeOffProblem } from '@/lib/time-off';

/**
 * Time off: close a run of dates in one go — a holiday, a bank holiday, a
 * day off — and open it again. Each date becomes what a closed day already
 * is (a date override, is_closed), so the booking page stops offering it
 * with no other change.
 *
 * Bookings already made inside the run are not touched. They are listed,
 * before and after, so the business decides about each one: moving somebody
 * is a conversation, not a side effect.
 */

async function bookingsInside(scope: TenantScope, timezone: string, from: string, to: string) {
  const start = DateTime.fromISO(from, { zone: timezone }).startOf('day').toUTC().toISO()!;
  const end = DateTime.fromISO(to, { zone: timezone }).plus({ days: 1 }).startOf('day').toUTC().toISO()!;
  const { data, error } = await scope
    .select('bookings', 'id, name, starts_at, event_types(name)')
    .eq('status', 'confirmed')
    .gte('starts_at', start)
    .lt('starts_at', end)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (
    (data ?? []) as unknown as Array<{
      id: string;
      name: string;
      starts_at: string;
      event_types: { name: string } | null;
    }>
  ).map((b) => ({
    id: b.id,
    name: b.name,
    startsAt: b.starts_at,
    serviceName: b.event_types?.name ?? 'A session',
  }));
}

async function overridesBetween(scope: TenantScope, from: string, to: string): Promise<DateOverrideRow[]> {
  const { data, error } = await scope.select('date_overrides').gte('date', from).lte('date', to);
  if (error) throw error;
  return (data ?? []) as unknown as DateOverrideRow[];
}

/** Time off from today on, as runs. */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);
    const today = DateTime.now().setZone(tenant.timezone).toISODate()!;
    const { data, error } = await scope
      .select('date_overrides')
      .gte('date', today)
      .order('date', { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as unknown as DateOverrideRow[];
    return ok({
      today,
      runs: closedRuns(rows.map((r) => ({ date: r.date, isClosed: r.is_closed, note: r.note }))),
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Close every date from `from` to `to`. With `dryRun`, only say what that
 * would do: how many days, and which bookings fall inside.
 *
 * A day that had its own hours is closed instead — time off means closed.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);
    const from = requireDate(body, 'from');
    const to = requireDate(body, 'to');
    const note = optionalString(body, 'note', { maxLength: 200 }) ?? null;
    const dryRun = optionalBoolean(body, 'dryRun') ?? false;

    const today = DateTime.now().setZone(tenant.timezone).toISODate()!;
    const problem = timeOffProblem(from, to, today);
    if (problem) return fail(problem, 400);

    const dates = datesBetween(from, to);
    const existing = await overridesBetween(scope, from, to);
    const alreadyClosed = new Set(existing.filter((o) => o.is_closed).map((o) => o.date));
    const ownHours = existing.filter((o) => !o.is_closed);
    const bookings = await bookingsInside(scope, tenant.timezone, from, to);

    const summary = {
      days: dates.length,
      alreadyClosed: alreadyClosed.size,
      replacingOwnHours: ownHours.length,
      bookings,
    };
    if (dryRun) return ok(summary);

    if (ownHours.length > 0) {
      const removed = await scope.delete('date_overrides').in(
        'id',
        ownHours.map((o) => o.id),
      );
      if (removed.error) throw removed.error;
    }
    const toClose = dates.filter((d) => !alreadyClosed.has(d));
    if (toClose.length > 0) {
      const inserted = await scope.insert(
        'date_overrides',
        toClose.map((date) => ({ date, is_closed: true, start_time: null, end_time: null, note })),
      );
      if (inserted.error) throw inserted.error;
    }
    return ok({ ...summary, closed: toClose.length }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** Open a run again: removes the closed days from `from` to `to`. Days with their own hours stay. */
export async function DELETE(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);
    const from = requireDate(body, 'from');
    const to = requireDate(body, 'to');
    if (to < from) return fail('The last day is before the first.', 400);
    const { error } = await scope
      .delete('date_overrides')
      .eq('is_closed', true)
      .gte('date', from)
      .lte('date', to);
    if (error) throw error;
    return ok({ reopened: true });
  } catch (error) {
    return handleError(error);
  }
}
