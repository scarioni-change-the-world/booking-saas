import { fail, handleError, ok, readJson, requireInt } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import type { ClientEntitlementRow } from '@/lib/db/types';

/** Correct a package's total — a typo'd grant, or an agreed top-up you'd rather set as an exact number than add to. */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string; entId: string }> },
) {
  try {
    const { slug, entId } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const totalSessions = requireInt(body, 'totalSessions', { min: 1, max: 1000 });

    const { data: existing, error: findError } = await scope
      .select('client_entitlements')
      .eq('id', entId)
      .maybeSingle();
    if (findError) throw findError;
    if (!existing) return fail('Not found', 404);

    const row = existing as unknown as ClientEntitlementRow;
    if (totalSessions < row.used_sessions) {
      return fail(
        `Can't set the total below ${row.used_sessions} — that's how many they've already used`,
        400,
      );
    }

    const { data, error } = await scope
      .update('client_entitlements', {
        total_sessions: totalSessions,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entId)
      .select();
    if (error) throw error;

    const updated = (data as unknown as ClientEntitlementRow[])[0]!;
    return ok({
      entitlement: {
        id: updated.id,
        eventTypeId: updated.event_type_id,
        totalSessions: updated.total_sessions,
        usedSessions: updated.used_sessions,
        remaining: updated.total_sessions - updated.used_sessions,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

/** Remove a package grant. Bookings already made against it keep their own record — only the link back to this grant clears (migration 0010). */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string; entId: string }> },
) {
  try {
    const { slug, entId } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const { error } = await scope.delete('client_entitlements').eq('id', entId);
    if (error) throw error;

    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
