import { fail, handleError, isResponse, ok, requireTenant } from '@/lib/api';
import { listClientEntitlements, resolveClientByToken } from '@/lib/booking-service';

/**
 * Resolve a client's own private booking link.
 *
 * Same posture as a booking's manage token (brief 2.4): the token IS the
 * credential, no login, and a token that doesn't resolve gets the same 404
 * as one that resolves to nothing — this endpoint can't be used to probe
 * whether a token is real.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ slug: string; token: string }> },
) {
  try {
    const { slug, token } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const { scope } = resolved;
    const client = await resolveClientByToken(scope, token);
    if (!client) return fail('Not found', 404);

    const entitlements = await listClientEntitlements(scope, client.id);

    return ok({
      client: { name: client.name, email: client.email },
      entitlements,
    });
  } catch (error) {
    return handleError(error);
  }
}
