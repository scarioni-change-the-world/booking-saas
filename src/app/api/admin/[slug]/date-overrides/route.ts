import {
  fail,
  handleError,
  ok,
  optionalBoolean,
  optionalString,
  readJson,
  requireString,
  requireTime,
} from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeDateOverride } from '@/lib/admin-serializers';
import { BookingError } from '@/lib/booking-service';
import type { DateOverrideRow } from '@/lib/db/types';

/** Every date override — holidays and special-hours days alike, past and future. */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const { data, error } = await scope
      .select('date_overrides')
      .order('date', { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as unknown as DateOverrideRow[];
    return ok({ overrides: rows.map(serializeDateOverride) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Close a date outright, or give it special hours instead of the usual
 * weekly schedule — an override replaces that day's rules entirely rather
 * than adding to them (see the slot engine's own note on this).
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const date = requireString(body, 'date', { maxLength: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BookingError('"date" must look like "2027-01-01"', 400);
    }

    const isClosed = optionalBoolean(body, 'isClosed') ?? true;
    const note = optionalString(body, 'note', { maxLength: 500 });

    let startTime: string | null = null;
    let endTime: string | null = null;
    if (!isClosed) {
      startTime = requireTime(body, 'startTime');
      endTime = requireTime(body, 'endTime');
      if (startTime >= endTime) {
        throw new BookingError('End time must be after the start time', 400);
      }
    }

    const { data, error } = await scope.insert('date_overrides', {
      date,
      is_closed: isClosed,
      start_time: startTime,
      end_time: endTime,
      note: note ?? null,
    });

    if (error) {
      // 23505 = unique_violation on (tenant_id, date) — one override per date.
      if (error.code === '23505') {
        return fail('You already have an exception for that date — remove it first', 409);
      }
      throw error;
    }

    const row = (data as unknown as DateOverrideRow[])[0]!;
    return ok({ override: serializeDateOverride(row) }, 201);
  } catch (error) {
    return handleError(error);
  }
}
