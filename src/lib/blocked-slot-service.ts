import { DateTime } from 'luxon';
import { atLocalTime } from './availability';
import {
  carveRange,
  dayBoundsUtc,
  minutesIntoDay,
  minutesToTimeLabel,
  parseTimeToMinutes,
  type BlockedInterval,
} from './blocked-slots';
import { BookingError } from './booking-service';
import type { TenantScope } from './db';
import type { BlockedSlotRow } from './db/types';

/**
 * The database-touching half of ad hoc hour blocking — the routes under
 * /api/admin/[slug]/blocked-slots call into this rather than querying
 * directly, the same split availability.ts (pure) / booking-service.ts
 * (impure) already draws for the core slot engine. blocked-slots.ts stays
 * pure and independently testable; the DateTime <-> Postgres wiring and the
 * shape of what a route returns live here.
 */

export interface DayBlock {
  id: string;
  startMinutes: number;
  endMinutes: number;
  reason: string | null;
}

async function fetchOverlapping(
  scope: TenantScope,
  from: DateTime,
  to: DateTime,
): Promise<BlockedSlotRow[]> {
  const { data, error } = await scope
    .select('blocked_slots')
    .lt('starts_at', to.toUTC().toISO()!)
    .gt('ends_at', from.toUTC().toISO()!)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as BlockedSlotRow[];
}

function toDayBlocks(rows: BlockedSlotRow[], bounds: { start: DateTime; end: DateTime }): DayBlock[] {
  return rows.map((row) => ({
    id: row.id,
    startMinutes: minutesIntoDay(DateTime.fromISO(row.starts_at, { zone: 'utc' }), bounds),
    endMinutes: minutesIntoDay(DateTime.fromISO(row.ends_at, { zone: 'utc' }), bounds),
    reason: row.reason,
  }));
}

function requireDayBounds(date: string, timezone: string) {
  const bounds = dayBoundsUtc(date, timezone);
  if (!bounds) throw new BookingError('That date does not exist in this timezone', 400);
  return bounds;
}

function resolveRange(timezone: string, date: string, startTime: string, endTime: string) {
  const local = DateTime.fromISO(date, { zone: timezone }).startOf('day');
  const start = atLocalTime(local, startTime);
  const end = atLocalTime(local, endTime);
  if (!start || !end) {
    throw new BookingError('That time does not exist in this timezone on this date', 400);
  }
  return { start, end };
}

/** Every block whose range touches this one tenant-local calendar date. */
export async function loadDayBlocks(
  scope: TenantScope,
  timezone: string,
  date: string,
): Promise<DayBlock[]> {
  const bounds = requireDayBounds(date, timezone);
  const rows = await fetchOverlapping(scope, bounds.start, bounds.end);
  return toDayBlocks(rows, bounds);
}

/** Block a wall-clock range on one date. */
export async function createBlock(
  scope: TenantScope,
  timezone: string,
  input: { date: string; startTime: string; endTime: string; reason: string | null },
): Promise<DayBlock> {
  const { start, end } = resolveRange(timezone, input.date, input.startTime, input.endTime);

  const { data, error } = await scope.insert('blocked_slots', {
    starts_at: start.toUTC().toISO()!,
    ends_at: end.toUTC().toISO()!,
    reason: input.reason,
  });
  if (error) throw error;

  const row = (data as unknown as BlockedSlotRow[])[0]!;
  return {
    id: row.id,
    startMinutes: parseTimeToMinutes(input.startTime),
    endMinutes: parseTimeToMinutes(input.endTime),
    reason: row.reason,
  };
}

/**
 * Reopen a wall-clock range on one date — shrinking or splitting whatever
 * blocks currently cover it (carveRange) rather than deleting a whole block
 * just because part of it fell inside the requested range. Returns the
 * date's blocks afterward, same shape as loadDayBlocks, so the caller can
 * just replace its state with the result.
 */
export async function unblockRange(
  scope: TenantScope,
  timezone: string,
  input: { date: string; startTime: string; endTime: string },
): Promise<DayBlock[]> {
  const { start, end } = resolveRange(timezone, input.date, input.startTime, input.endTime);

  const rows = await fetchOverlapping(scope, start, end);
  const intervals: BlockedInterval[] = rows.map((row) => ({
    id: row.id,
    startsAt: DateTime.fromISO(row.starts_at, { zone: 'utc' }),
    endsAt: DateTime.fromISO(row.ends_at, { zone: 'utc' }),
    reason: row.reason,
  }));

  const plan = carveRange(intervals, start, end);

  if (plan.toDelete.length > 0) {
    const { error } = await scope.delete('blocked_slots').in('id', plan.toDelete);
    if (error) throw error;
  }
  for (const update of plan.toUpdate) {
    const { error } = await scope
      .update('blocked_slots', {
        starts_at: update.startsAt.toUTC().toISO()!,
        ends_at: update.endsAt.toUTC().toISO()!,
      })
      .eq('id', update.id);
    if (error) throw error;
  }
  if (plan.toInsert.length > 0) {
    const { error } = await scope.insert(
      'blocked_slots',
      plan.toInsert.map((row) => ({
        starts_at: row.startsAt.toUTC().toISO()!,
        ends_at: row.endsAt.toUTC().toISO()!,
        reason: row.reason,
      })),
    );
    if (error) throw error;
  }

  const bounds = requireDayBounds(input.date, timezone);
  const fresh = await fetchOverlapping(scope, bounds.start, bounds.end);
  return toDayBlocks(fresh, bounds);
}

/** Change only the reason on an existing block — the "add a reason later"
 * affordance the day list offers instead of gating creation on it. Returns
 * false rather than throwing when the id doesn't exist (or belongs to
 * another tenant, indistinguishable under this scope), so the route can
 * answer with a plain 404. */
export async function updateBlockReason(
  scope: TenantScope,
  id: string,
  reason: string | null,
): Promise<boolean> {
  const { data, error } = await scope.update('blocked_slots', { reason }).eq('id', id).select();
  if (error) throw error;
  return (data as unknown as BlockedSlotRow[]).length > 0;
}

/**
 * Replace one date's entire set of blocks with an exact snapshot — the undo
 * mechanism. Blocking and unblocking both act instantly now (no confirm
 * step), so "undo" isn't a reverse API call, it's "put the day back exactly
 * how it looked a moment ago": delete whatever is there now, recreate the
 * snapshot's rows verbatim. Correct even for undoing an unblock that split
 * or shrank several differently-reasoned blocks at once, because it restores
 * the whole day's prior shape rather than trying to invert one operation.
 *
 * Only safe because nothing else can have touched this day in the moment
 * between the action and the undo — true for a single admin editing their
 * own calendar, which is what this UI is for.
 */
export async function replaceDayBlocks(
  scope: TenantScope,
  timezone: string,
  date: string,
  snapshot: readonly DayBlock[],
): Promise<DayBlock[]> {
  const bounds = requireDayBounds(date, timezone);

  const current = await fetchOverlapping(scope, bounds.start, bounds.end);
  if (current.length > 0) {
    const { error } = await scope.delete('blocked_slots').in('id', current.map((r) => r.id));
    if (error) throw error;
  }

  if (snapshot.length > 0) {
    const rows = snapshot.map((b) => {
      // Inverting minutesIntoDay: reconstruct by wall-clock position, not by
      // adding elapsed minutes to bounds.start — the same DST distinction
      // minutesIntoDay itself exists to get right. minutesToTimeLabel clamps
      // at 23:59 (it's meant for display), so 1440 — "the next local
      // midnight" — is handled separately as bounds.end, which is exactly
      // that instant. startMinutes can never legitimately be 1440: the
      // overlap query that produced this snapshot only ever returns rows
      // with starts_at strictly before bounds.end.
      const start = atLocalTime(bounds.start, minutesToTimeLabel(b.startMinutes)) ?? bounds.start;
      const end =
        b.endMinutes >= 1440 ? bounds.end : (atLocalTime(bounds.start, minutesToTimeLabel(b.endMinutes)) ?? bounds.end);
      return {
        starts_at: start.toUTC().toISO()!,
        ends_at: end.toUTC().toISO()!,
        reason: b.reason,
      };
    });
    const { error } = await scope.insert('blocked_slots', rows);
    if (error) throw error;
  }

  const fresh = await fetchOverlapping(scope, bounds.start, bounds.end);
  return toDayBlocks(fresh, bounds);
}
