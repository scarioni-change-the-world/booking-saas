import { handleError, ok, readJson, requireDate } from '@/lib/api';
import { requireTenantMember } from '@/lib/auth';
import { replaceDayBlocks, type DayBlock } from '@/lib/blocked-slot-service';
import { BookingError } from '@/lib/booking-service';

/**
 * Undo. Not a reverse of one specific block/unblock call — see
 * replaceDayBlocks — but "put this date back exactly how it looked a moment
 * ago," which is what a single undo button after either action actually
 * needs. The caller (DaySchedule) is the one holding onto "how it looked a
 * moment ago"; this route just makes it real again.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantMember(request, slug);
    const body = await readJson(request);

    const date = requireDate(body, 'date');
    const blocks = parseSnapshot(body.blocks);

    const fresh = await replaceDayBlocks(scope, tenant.timezone, date, blocks);
    return ok({ date, blocks: fresh });
  } catch (error) {
    return handleError(error);
  }
}

function parseSnapshot(value: unknown): DayBlock[] {
  if (!Array.isArray(value)) {
    throw new BookingError('"blocks" must be an array', 400);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new BookingError(`blocks[${index}] must be an object`, 400);
    }
    const { startMinutes, endMinutes, reason } = entry as Record<string, unknown>;
    if (
      typeof startMinutes !== 'number' ||
      typeof endMinutes !== 'number' ||
      !Number.isFinite(startMinutes) ||
      !Number.isFinite(endMinutes) ||
      startMinutes < 0 ||
      endMinutes > 1440 ||
      startMinutes >= endMinutes
    ) {
      throw new BookingError(`blocks[${index}] has an invalid time range`, 400);
    }
    if (reason !== null && reason !== undefined && typeof reason !== 'string') {
      throw new BookingError(`blocks[${index}].reason must be a string or null`, 400);
    }
    // id is deliberately not read: every restored row is a fresh insert, not
    // an update of the row that used to hold that id.
    return { id: '', startMinutes, endMinutes, reason: (reason as string | undefined) ?? null };
  });
}
