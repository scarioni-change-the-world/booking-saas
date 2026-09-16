import { fail, handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { sendClientInviteEmail } from '@/lib/client-email';
import type { ClientRow } from '@/lib/db/types';

/**
 * Send an existing client their booking link again.
 *
 * The ordinary answer to "I've lost my link": an admin who can see the
 * client in their dashboard re-sends it, with no need for the client to
 * prove anything to anyone. The public self-serve version of this
 * (/api/t/[slug]/client-link) exists for when the admin isn't there to
 * ask, and has to be much more careful about what it admits to knowing —
 * this route has no such problem, because the caller is already an
 * authenticated admin of this tenant.
 *
 * The token itself is unchanged: this re-sends the existing link rather
 * than rotating it, so any copy the client still has keeps working. Losing
 * an email is the common case; a leaked token is a different problem, and
 * would want a deliberate "issue a new link" action that breaks the old one.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);

    const { data, error } = await scope.select('clients').eq('id', id).maybeSingle();
    if (error) throw error;

    const client = data as unknown as ClientRow | null;
    if (!client) return fail('Not found', 404);

    const inviteStatus = await sendClientInviteEmail(tenant, scope, client);
    return ok({ inviteStatus });
  } catch (error) {
    return handleError(error);
  }
}
