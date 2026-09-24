import { fail, handleError, ok, optionalBoolean, readJson, requireEmail, requireString } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { sendClientInviteEmail } from '@/lib/client-email';
import { serializeClient } from '@/lib/admin-serializers';
import { loadClients } from '@/lib/client-list';
import { generateManageToken } from '@/lib/tokens';
import type { ClientRow } from '@/lib/db/types';

/**
 * Every client, with their package balances alongside them — the whole
 * point of this list is "who has sessions left", not just "who exists".
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    return ok({ clients: await loadClients(scope) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Add a client — their own private booking link (access_token) is generated
 * here, the same shape as a booking's manage token. No package yet; that's
 * granted separately once you know what they bought.
 *
 * Every booking already makes a client record for the person who booked
 * (see createBooking), so this is for the two cases that leaves: somebody
 * the business knows who has never booked, added from People, and somebody
 * whose booking predates that or whose record could not be made at the
 * time — given their link from the booking or from People. Both are this
 * one call, prefilled differently, not a second way in.
 *
 * `sendInvite` decides whether they're emailed their link now. Its outcome
 * comes back on the response rather than being swallowed: "saved, but we
 * couldn't email them" is something an admin needs to see, since the link
 * is useless to a client who never receives it.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const name = requireString(body, 'name', { maxLength: 200 });
    const email = requireEmail(body, 'email');
    const sendInvite = optionalBoolean(body, 'sendInvite') ?? false;

    const { data, error } = await scope.insert('clients', {
      name,
      email,
      access_token: generateManageToken(),
    });

    if (error) {
      // unique_violation on (tenant_id, lower(email)) — this person already
      // has a client record.
      if (error.code === '23505') {
        return fail('This person already has a client record — search for their email instead', 409);
      }
      throw error;
    }

    const row = (data as unknown as ClientRow[])[0]!;
    const inviteStatus = sendInvite ? await sendClientInviteEmail(tenant, scope, row) : null;

    return ok({ client: { ...serializeClient(row), entitlements: [] }, inviteStatus }, 201);
  } catch (error) {
    return handleError(error);
  }
}
