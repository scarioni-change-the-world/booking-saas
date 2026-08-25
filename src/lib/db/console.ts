import { BookingError } from '../booking-service';
import { __unsafeServiceClient } from './client';
import type { MemberRole, TenantPlan, TenantRow, TenantStatus } from './types';

/**
 * The console's own data access — every query here is deliberately unscoped,
 * the same way resolveTenantBySlug and resolveBookingByToken are: this *is*
 * the cross-tenant view. What makes that safe is that every caller reaches
 * these functions through an API route gated by requirePlatformStaff first,
 * exactly as the tenant-scoped routes are gated by requireTenantAdmin before
 * they ever touch a TenantScope.
 */

/** Every tenant, newest first. */
export async function listAllTenants(): Promise<TenantRow[]> {
  const { data, error } = await __unsafeServiceClient()
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as TenantRow[];
}

export async function getTenantById(id: string): Promise<TenantRow | null> {
  const { data, error } = await __unsafeServiceClient()
    .from('tenants')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data as TenantRow | null;
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  timezone: string;
  ownerEmail: string;
}

/**
 * Create a business and invite its first person in one step.
 *
 * tenant_settings needs no insert here — migration 0009's trigger creates it
 * the moment the tenants row exists, so there is no window where a tenant
 * exists without it.
 *
 * The owner invite goes through Supabase's own "invite by email", which both
 * creates their login and sends them the email to set a password — nothing
 * here sends mail itself. If the invite fails (most commonly: that email
 * already has an account elsewhere), the tenant is deleted again rather than
 * left behind with no one able to sign in to it.
 */
export async function createTenant(input: CreateTenantInput): Promise<TenantRow> {
  const client = __unsafeServiceClient();

  const { data: tenantData, error: tenantError } = await client
    .from('tenants')
    .insert({ slug: input.slug, name: input.name, timezone: input.timezone })
    .select()
    .single();

  if (tenantError) {
    // 23505 = unique_violation on slug — one business per web address.
    if (tenantError.code === '23505') {
      throw new BookingError('That web address is already taken', 409);
    }
    throw tenantError;
  }
  const tenant = tenantData as TenantRow;

  const { data: invited, error: inviteError } = await client.auth.admin.inviteUserByEmail(
    input.ownerEmail,
  );

  if (inviteError || !invited?.user) {
    await client.from('tenants').delete().eq('id', tenant.id);
    throw new BookingError(
      inviteError?.message ?? 'Could not invite the owner — the business was not created',
      400,
    );
  }

  const { error: memberError } = await client
    .from('tenant_members')
    .insert({ tenant_id: tenant.id, user_id: invited.user.id, role: 'owner' as MemberRole });

  if (memberError) {
    await client.from('tenants').delete().eq('id', tenant.id);
    throw memberError;
  }

  return tenant;
}

export interface UpdateTenantInput {
  name?: string;
  timezone?: string;
  status?: TenantStatus;
  plan?: TenantPlan;
}

export async function updateTenant(id: string, patch: UpdateTenantInput): Promise<TenantRow> {
  const { data, error } = await __unsafeServiceClient()
    .from('tenants')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new BookingError('Not found', 404);
  return data as TenantRow;
}

export interface TenantMemberSummary {
  userId: string;
  email: string | null;
  role: MemberRole;
  createdAt: string;
}

/**
 * Who has access to one business's dashboard, with their email attached.
 *
 * auth.users isn't reachable through the regular data API (PostgREST only
 * exposes the public schema), so each email is its own admin-API lookup —
 * fine at the handful of people an actual small business has on its team.
 */
export async function listTenantMembers(tenantId: string): Promise<TenantMemberSummary[]> {
  const client = __unsafeServiceClient();

  const { data, error } = await client
    .from('tenant_members')
    .select('user_id, role, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  const rows = (data ?? []) as { user_id: string; role: MemberRole; created_at: string }[];

  return Promise.all(
    rows.map(async (row) => {
      const { data: userData } = await client.auth.admin.getUserById(row.user_id);
      return {
        userId: row.user_id,
        email: userData.user?.email ?? null,
        role: row.role,
        createdAt: row.created_at,
      };
    }),
  );
}

/**
 * Give someone access to a business's dashboard, inviting them fresh via
 * Supabase auth if they don't already have a login.
 *
 * There is deliberately no path here for adding someone who already has an
 * account elsewhere (their own business, or platform staff) to a second
 * business — inviteUserByEmail fails for an email already registered, and
 * that failure is surfaced as-is rather than guessed around. Reusing one
 * login across businesses is a real feature; it just isn't this one.
 */
export async function addTenantMember(
  tenantId: string,
  email: string,
  role: MemberRole,
): Promise<TenantMemberSummary> {
  const client = __unsafeServiceClient();

  const { data: invited, error: inviteError } = await client.auth.admin.inviteUserByEmail(email);
  if (inviteError || !invited?.user) {
    throw new BookingError(inviteError?.message ?? 'Could not invite that person', 400);
  }

  const { data, error } = await client
    .from('tenant_members')
    .insert({ tenant_id: tenantId, user_id: invited.user.id, role })
    .select('user_id, role, created_at')
    .single();

  if (error) throw error;
  const row = data as { user_id: string; role: MemberRole; created_at: string };

  return { userId: row.user_id, email: invited.user.email ?? null, role: row.role, createdAt: row.created_at };
}

/**
 * Take someone's access away.
 *
 * Refuses to remove a business's last owner — an empty business, with no one
 * able to administer it, is a support ticket waiting to happen, and it's
 * cheap to just not allow it.
 */
export async function removeTenantMember(tenantId: string, userId: string): Promise<void> {
  const client = __unsafeServiceClient();

  const { data: target, error: targetError } = await client
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (targetError) throw targetError;
  if (!target) return; // already gone

  if ((target as { role: MemberRole }).role === 'owner') {
    const { count, error: countError } = await client
      .from('tenant_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('role', 'owner');

    if (countError) throw countError;
    if ((count ?? 0) <= 1) {
      throw new BookingError('Every business needs at least one owner — add another owner first', 409);
    }
  }

  const { error } = await client
    .from('tenant_members')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('user_id', userId);

  if (error) throw error;
}
