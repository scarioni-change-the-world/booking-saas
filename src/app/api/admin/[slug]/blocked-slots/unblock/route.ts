import { handleError, ok, readJson, requireDate, requireTime } from '@/lib/api';
import { requireTenantMember } from '@/lib/auth';
import { unblockRange } from '@/lib/blocked-slot-service';
import { BookingError } from '@/lib/booking-service';

/**
 * Reopen a wall-clock range on one date — clicking or dragging across
 * already-blocked cells in the grid.
 *
 * A dedicated action route rather than DELETE on a specific block's id (see
 * .../[id]/route.ts, which still exists for the plain list view): the cell
 * someone clicks may be only part of a block a single earlier drag created
 * spanning several cells, and this must reopen only the requested range —
 * shrinking or splitting the block(s) underneath it (blocked-slot-service's
 * unblockRange, via the pure carveRange) — never the whole thing just
 * because part of it was touched. Same "action verb" shape as
 * questions/[id]/move.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantMember(request, slug);
    const body = await readJson(request);

    const date = requireDate(body, 'date');
    const startTime = requireTime(body, 'startTime');
    const endTime = requireTime(body, 'endTime');
    if (startTime >= endTime) {
      throw new BookingError('End time must be after the start time', 400);
    }

    const blocks = await unblockRange(scope, tenant.timezone, { date, startTime, endTime });
    return ok({ date, blocks });
  } catch (error) {
    return handleError(error);
  }
}
