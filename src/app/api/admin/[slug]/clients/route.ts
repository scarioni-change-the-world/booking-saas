import { fail, handleError, ok, optionalBoolean, readJson, requireEmail, requireString } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { sendClientInviteEmail } from '@/lib/client-email';
import { serializeClient } from '@/lib/admin-serializers';
import { generateManageToken } from '@/lib/tokens';
import type { ClientRow } from '@/lib/db/types';

interface EntitlementJoin {
  id: string;
  event_type_id: string;
  total_sessions: number;
  used_sessions: number;
  event_types: { name: string } | null;
}

/**
 * Every client, with their package balances alongside them — the whole
 * point of this list is "who has sessions left", not just "who exists".
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const { data, error } = await scope
      .select(
        'clients',
        '*, client_entitlements(id, event_type_id, total_sessions, used_sessions, event_types(name))',
      )
      .order('created_at', { ascending: false });

    if (error) throw error;

    const rows = (data ?? []) as unknown as Array<ClientRow & { client_entitlements: EntitlementJoin[] }>;

    return ok({
      clients: rows.map((row) => ({
        ...serializeClient(row),
        entitlements: row.client_entitlements.map((e) => ({
          id: e.id,
          eventTypeId: e.event_type_id,
          eventTypeName: e.event_types?.name ?? 'Unknown session type',
          totalSessions: e.total_sessions,
          usedSessions: e.used_sessions,
          remaining: e.total_sessions - e.used_sessions,
        })),
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Add a client — their own private booking link (access_token) is generated
 * here, the same shape as a booking's manage token. No package yet; that's
 * granted separately once you know what they bought.
 *
 * This is the single path a client record is created through, whether it
 * was typed on the Clients page or promoted from a booking on the Bookings
 * page — the same reasoning the AI intake-draft route gives for sending
 * accepted drafts back through the ordinary questions route. Promotion from
 * a booking is that page prefilling this call, not a second way in.
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
