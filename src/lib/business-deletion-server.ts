import { DateTime } from 'luxon';
import { cancelBooking } from './booking-service';
import { refundOnCancel } from './client-payments';
import { revokeGrant } from './calendar/connections';
import { __unsafeServiceClient } from './db/client';
import { listTenantMembers } from './db/console';
import { removeTenantLogo } from './db/branding';
import { tenantScope } from './db/scope';
import type { BookingRow, CalendarConnectionRow, TenantRow } from './db/types';
import { stripe, stripeConfigured } from './stripe';
import { CLOSING_REASON, type BusinessDeletionFacts } from './business-deletion';
import { sendBusinessDeletedEmail } from './business-deletion-email';

interface Login {
  userId: string;
  email: string | null;
  role: string;
  /** On another business, or khloe staff: the login stays. */
  keep: boolean;
}

/** The team's logins, each marked keep (on another business, or staff) or delete. */
async function teamLogins(tenantId: string): Promise<Login[]> {
  const client = __unsafeServiceClient();
  const members = await listTenantMembers(tenantId);
  if (members.length === 0) return [];
  const ids = members.map((m) => m.userId);
  const [elsewhere, staff] = await Promise.all([
    client.from('tenant_members').select('user_id').in('user_id', ids).neq('tenant_id', tenantId),
    client.from('platform_staff').select('user_id').in('user_id', ids),
  ]);
  if (elsewhere.error) throw elsewhere.error;
  if (staff.error) throw staff.error;
  const kept = new Set([
    ...((elsewhere.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
    ...((staff.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
  ]);
  return members.map((m) => ({ userId: m.userId, email: m.email, role: m.role, keep: kept.has(m.userId) }));
}

/** Everything the console panel says before deleting, and the route checks again. */
export async function loadBusinessDeletionFacts(tenant: TenantRow): Promise<BusinessDeletionFacts> {
  const scope = tenantScope(tenant.id);
  const now = new Date().toISOString();
  const [upcoming, past, owed, clients, services, calendar, logins] = await Promise.all([
    scope
      .select('bookings', 'starts_at, payment_id')
      .eq('status', 'confirmed')
      .gte('starts_at', now)
      .order('starts_at', { ascending: false }),
    scope.select('bookings', 'id').lt('starts_at', now),
    scope.select('client_entitlements', 'client_id, total_sessions, used_sessions'),
    scope.select('clients', 'id'),
    scope.select('event_types', 'id, deleted_at'),
    scope.select('calendar_connections', 'id').maybeSingle(),
    teamLogins(tenant.id),
  ]);
  for (const result of [upcoming, past, owed, clients, services]) if (result.error) throw result.error;

  const upcomingRows = (upcoming.data ?? []) as unknown as Array<{ starts_at: string; payment_id: string | null }>;
  const owedRows = ((owed.data ?? []) as unknown as Array<{ client_id: string; total_sessions: number; used_sessions: number }>).filter(
    (e) => e.total_sessions - e.used_sessions > 0,
  );

  return {
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    upcoming: upcomingRows.length,
    upcomingPaid: upcomingRows.filter((b) => b.payment_id).length,
    lastUpcomingAt: upcomingRows[0]?.starts_at ?? null,
    owedSessions: owedRows.reduce((sum, e) => sum + (e.total_sessions - e.used_sessions), 0),
    owedClients: new Set(owedRows.map((e) => e.client_id)).size,
    clients: (clients.data ?? []).length,
    pastAppointments: (past.data ?? []).length,
    services: ((services.data ?? []) as unknown as Array<{ deleted_at: string | null }>).filter((s) => !s.deleted_at).length,
    loginsDeleted: logins.filter((l) => !l.keep).length,
    loginsKept: logins.filter((l) => l.keep).length,
    calendarConnected: !calendar.error && !!calendar.data,
    subscription:
      !!tenant.stripe_subscription_id && !['canceled', 'incomplete_expired'].includes(tenant.subscription_status ?? ''),
  };
}

export interface BusinessDeletionResult {
  cancelled: number;
  refunded: number;
  loginsDeleted: number;
  ownersEmailed: number;
}

/**
 * Delete a business for good. The route has already checked who is asking,
 * the blockers, and the web address typed back.
 *
 * The order is what makes it safe:
 *   1. Cancel every appointment still to come, the business's own way:
 *      the client's cancellation email, the calendar event removed, a
 *      refund when it was paid online. A cancellation that cannot be saved
 *      stops everything here, before anything is deleted, so nobody turns
 *      up to an appointment that silently vanished.
 *   2. Stop the khloe subscription. One Stripe will not cancel also stops
 *      everything: a business that is gone must not keep being charged.
 *   3. Outside the database, best effort: the calendar grant, the logo.
 *   4. The database, in one transaction (delete_tenant, migration 0037).
 *      The web address is free from this moment.
 *   5. The logins on no other business, so their addresses can sign up
 *      again; then each owner gets the confirmation.
 */
export async function deleteBusiness(tenant: TenantRow): Promise<BusinessDeletionResult> {
  const client = __unsafeServiceClient();
  const scope = tenantScope(tenant.id);

  // Who to tell and which logins go: read before anything is removed.
  const logins = await teamLogins(tenant.id);

  // 1. Appointments still to come.
  const { data, error } = await scope
    .select('bookings')
    .eq('status', 'confirmed')
    .gte('starts_at', new Date().toISOString());
  if (error) throw error;
  let cancelled = 0;
  let refunded = 0;
  for (const booking of (data ?? []) as unknown as BookingRow[]) {
    await cancelBooking(tenant, scope, booking, CLOSING_REASON, 'business');
    cancelled += 1;
    const refund = await refundOnCancel(scope, booking, 'business').catch((cause) => {
      console.error('[business-deletion] refund failed for a cancelled appointment:', cause);
      return null;
    });
    if (refund?.status === 'refunded') refunded += 1;
  }

  // 2. The khloe subscription.
  if (stripeConfigured() && tenant.stripe_subscription_id && tenant.subscription_status !== 'canceled') {
    try {
      await stripe().subscriptions.cancel(tenant.stripe_subscription_id);
    } catch (cause) {
      // Already gone at Stripe is fine; anything else stops the deletion.
      if ((cause as { code?: string }).code !== 'resource_missing') throw cause;
    }
  }

  // 3. Outside the database, best effort.
  const calendar = await scope.select('calendar_connections').maybeSingle();
  if (!calendar.error && calendar.data) await revokeGrant(calendar.data as unknown as CalendarConnectionRow);
  await removeTenantLogo(tenant.id).catch((cause) => console.error('[business-deletion] logo not removed:', cause));

  // 4. Everything in the database, at once.
  const removed = await client.rpc('delete_tenant', { p_tenant: tenant.id });
  if (removed.error) throw removed.error;

  // 5. Logins on no other business, then the owners' confirmation.
  let loginsDeleted = 0;
  for (const login of logins.filter((l) => !l.keep)) {
    const gone = await client.auth.admin.deleteUser(login.userId);
    if (gone.error) console.error('[business-deletion] a login was not deleted:', gone.error.message);
    else loginsDeleted += 1;
  }

  const when = DateTime.now().setZone(tenant.timezone).toFormat("d LLLL yyyy 'at' HH:mm");
  let ownersEmailed = 0;
  for (const owner of logins.filter((l) => l.role === 'owner' && l.email)) {
    const status = await sendBusinessDeletedEmail({
      to: owner.email!,
      tenantName: tenant.name,
      slug: tenant.slug,
      when,
      cancelled,
      loginDeleted: !owner.keep,
    });
    if (status === 'sent') ownersEmailed += 1;
  }

  return { cancelled, refunded, loginsDeleted, ownersEmailed };
}
