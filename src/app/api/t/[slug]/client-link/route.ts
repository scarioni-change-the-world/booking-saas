import { handleError, isResponse, ok, readJson, requireEmail, requireTenant } from '@/lib/api';
import { sendClientInviteEmail } from '@/lib/client-email';
import { enforceRateLimit } from '@/lib/rate-limit';
import type { ClientRow } from '@/lib/db/types';

/**
 * "I've lost my booking link" — send it to me again.
 *
 * Deliberately says nothing about whether the address is on file. The
 * response is byte-identical either way, because the alternative turns a
 * convenience into a way to ask a business "is this person a customer of
 * yours?" one address at a time — the same posture as the 404s on
 * .../client/[token] and a booking's manage token, and the same reasoning
 * every well-behaved password-reset form uses.
 *
 * What that costs: someone who really has lost their link and mistypes
 * their address gets the same reassuring message as a success, and nothing
 * happens. That's the right trade — an admin can always re-send it from the
 * dashboard (.../clients/[id]/invite), which is the path this exists to
 * avoid needing, not replace.
 *
 * One residual signal is accepted rather than papered over: sending mail
 * takes longer than not sending it, so response time differs slightly
 * between a hit and a miss. Closing that would mean either deferring the
 * send past the response (machinery this app doesn't have) or padding every
 * miss, and the limits below already make sampling it in bulk impractical.
 *
 * Note this never rotates the token — it re-sends the existing link, so a
 * copy the client still has keeps working.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const { tenant, scope } = resolved;
    const body = await readJson(request);
    const email = requireEmail(body, 'email');

    // Two independent limits, because this endpoint sends mail to an
    // address the caller names: one bounds how much any single caller can
    // trigger, the other bounds how much any single inbox can receive even
    // if the requests come from everywhere. Both are enforced before the
    // lookup, so neither answer reveals more than the other.
    await enforceRateLimit(request, tenant.id, 'clientLinkRequest');
    await enforceRateLimit(request, tenant.id, 'clientLinkAddress', { subject: email });

    const { data, error } = await scope.select('clients').eq('email', email).maybeSingle();
    if (error) throw error;

    const client = data as unknown as ClientRow | null;
    if (client) {
      const status = await sendClientInviteEmail(tenant, scope, client);
      // Logged, never returned: the caller is told the same thing whether
      // this worked, found nobody, or found somebody and failed to reach
      // them. An admin chasing "they say they never got it" has this.
      if (status !== 'sent') {
        console.error(`[client-link] could not send to a known client: ${status}`);
      }
    }

    return ok({
      message:
        "If that address is on file with us, we've sent your booking link to it. Please check your inbox.",
    });
  } catch (error) {
    return handleError(error);
  }
}
