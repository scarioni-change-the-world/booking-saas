import { BookingError } from '../booking-service';
import { __unsafeServiceClient } from './client';
import type { MemberRole, TenantPlan, TenantRow, TenantStatus } from './types';
import { classifyError, type TenantFacts } from '../tenant-health';

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

/**
 * The login behind an email address, creating one if there isn't one yet.
 *
 * Both ways into a business's team — creating the business with its first
 * owner, and adding someone to an existing one — need the same thing: a
 * user_id for an address a person typed. Supabase's inviteUserByEmail gives
 * one only for addresses it has never seen; it refuses anything already
 * registered. On its own that made the platform's own first business
 * impossible to create, because the operator creating it is signed in under
 * the address they were trying to name as owner.
 *
 * So: look first, invite second. An address with a login already gets
 * attached to the business; one without gets invited exactly as before.
 *
 * `invited` is returned rather than inferred by the caller because it decides
 * what the person is told afterwards — "we've emailed them to set a
 * password" is wrong, and confusing, for someone who already has one.
 */
async function findOrInviteUser(
  email: string,
): Promise<{ userId: string; email: string | null; invited: boolean }> {
  const client = __unsafeServiceClient();

  const { data: existingId, error: lookupError } = await client.rpc('auth_user_id_by_email', {
    p_email: email,
  });
  if (lookupError) throw lookupError;

  if (existingId) {
    return { userId: existingId as string, email, invited: false };
  }

  const { data: invited, error: inviteError } = await client.auth.admin.inviteUserByEmail(email);
  if (inviteError || !invited?.user) {
    throw new BookingError(inviteError?.message ?? 'Could not invite that person', 400);
  }

  return { userId: invited.user.id, email: invited.user.email ?? email, invited: true };
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
 * tenant_settings and outcome_paths need no insert here — migration 0009's
 * and migration 0011's triggers create them the moment the tenants row
 * exists, so there is no window where a tenant exists without either.
 *
 * The owner is resolved through findOrInviteUser: an address that already has
 * a login is attached to the new business, and one that doesn't is invited
 * through Supabase's own "invite by email", which creates their login and
 * sends them the email to set a password — nothing here sends mail itself.
 * If that step fails, the tenant is deleted again rather than left behind
 * with no one able to sign in to it.
 *
 * Every tenant starts on a 7-day trial (trial_ends_at = now + 7 days) — see
 * migration 0018 and billing-gate.ts. Adjustable per-tenant afterwards from
 * the console, same as free_access.
 */
export async function createTenant(input: CreateTenantInput): Promise<TenantRow> {
  const client = __unsafeServiceClient();

  const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: tenantData, error: tenantError } = await client
    .from('tenants')
    .insert({
      slug: input.slug,
      name: input.name,
      timezone: input.timezone,
      trial_ends_at: trialEndsAt,
    })
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

  let owner: { userId: string };
  try {
    owner = await findOrInviteUser(input.ownerEmail);
  } catch (cause) {
    // A business whose owner could not be resolved is a business nobody can
    // sign in to, so it does not get to exist. Deleting it here keeps the
    // slug free for the retry that follows a corrected address.
    await client.from('tenants').delete().eq('id', tenant.id);
    throw cause instanceof BookingError
      ? new BookingError(`${cause.message} — the business was not created`, cause.status)
      : cause;
  }

  const { error: memberError } = await client
    .from('tenant_members')
    .insert({ tenant_id: tenant.id, user_id: owner.userId, role: 'owner' as MemberRole });

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
  /** Permanent comp override — see migration 0018 and billing-gate.ts. */
  free_access?: boolean;
  /** Temporary extension/shortening of the trial. Null clears it (a trial
   * tenant with no trial_ends_at is treated as not-yet-expired — see
   * billing-gate.ts). */
  trial_ends_at?: string | null;
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
 * Someone who already has an account — their own business, or platform staff
 * — is attached to this one rather than refused. That used to be a hard
 * failure (inviteUserByEmail rejects a registered address), which made one
 * person owning two businesses impossible to express. findOrInviteUser
 * resolves the address either way; see migration 0021 for why the lookup is
 * a database function rather than a paged scan.
 */
export async function addTenantMember(
  tenantId: string,
  email: string,
  role: MemberRole,
): Promise<TenantMemberSummary> {
  const client = __unsafeServiceClient();

  const person = await findOrInviteUser(email);

  const { data, error } = await client
    .from('tenant_members')
    .insert({ tenant_id: tenantId, user_id: person.userId, role })
    .select('user_id, role, created_at')
    .single();

  // 23505 = unique_violation on (tenant_id, user_id). Now that an existing
  // login can be added, adding the same person twice is an ordinary slip
  // rather than an impossible state, and deserves a sentence that says so
  // instead of a generic 500.
  if (error) {
    if (error.code === '23505') {
      throw new BookingError('That person already has access to this business', 409);
    }
    throw error;
  }
  const row = data as { user_id: string; role: MemberRole; created_at: string };

  return { userId: row.user_id, email: person.email, role: row.role, createdAt: row.created_at };
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

/**
 * The health of every business on the platform, as shape rather than
 * content.
 *
 * Every column read here is a count, a flag, a timestamp or an error
 * string that is classified and discarded before it leaves this function.
 * No names, no email addresses, no question wording, no answers, no client
 * list. See src/lib/tenant-health.ts for why that constraint is cheap and
 * what it is protecting.
 *
 * Six queries for the whole platform rather than six per business: a
 * support screen that costs a round trip per tenant stops being opened.
 */
export async function loadPlatformHealth(sinceIso: string): Promise<Map<string, TenantFacts>> {
  const client = __unsafeServiceClient();

  const [tenants, services, rules, questions, bookings, responses] = await Promise.all([
    client.from('tenants').select('id, created_at'),
    client
      .from('event_types')
      .select('tenant_id, available_to_prospects, available_to_existing_clients')
      .eq('active', true),
    client.from('availability_rules').select('tenant_id'),
    client.from('qualification_questions').select('tenant_id'),
    client
      .from('bookings')
      .select('tenant_id, created_at, email_status, email_error, sync_status, sync_error')
      .gte('created_at', sinceIso),
    client.from('qualification_responses').select('tenant_id, started_at').gte('started_at', sinceIso),
  ]);

  for (const result of [tenants, services, rules, questions, bookings, responses]) {
    if (result.error) throw result.error;
  }

  const facts = new Map<string, TenantFacts>();
  for (const row of (tenants.data ?? []) as Array<{ id: string; created_at: string }>) {
    facts.set(row.id, {
      activeServices: 0,
      servicesOfferedToNobody: 0,
      availabilityRuleCount: 0,
      questionCount: 0,
      emailsFailed: 0,
      emailErrorClasses: [],
      syncsFailed: 0,
      syncErrorClasses: [],
      lastBookingAt: null,
      lastEnquiryAt: null,
      bookingsInWindow: 0,
      enquiriesInWindow: 0,
      createdAt: row.created_at,
    });
  }

  const bump = (id: string, change: (f: TenantFacts) => TenantFacts) => {
    const current = facts.get(id);
    if (current) facts.set(id, change(current));
  };

  for (const s of (services.data ?? []) as Array<{
    tenant_id: string;
    available_to_prospects: boolean;
    available_to_existing_clients: boolean;
  }>) {
    const hidden = !s.available_to_prospects && !s.available_to_existing_clients;
    bump(s.tenant_id, (f) => ({
      ...f,
      activeServices: f.activeServices + 1,
      servicesOfferedToNobody: f.servicesOfferedToNobody + (hidden ? 1 : 0),
    }));
  }

  for (const r of (rules.data ?? []) as Array<{ tenant_id: string }>) {
    bump(r.tenant_id, (f) => ({ ...f, availabilityRuleCount: f.availabilityRuleCount + 1 }));
  }

  for (const q of (questions.data ?? []) as Array<{ tenant_id: string }>) {
    bump(q.tenant_id, (f) => ({ ...f, questionCount: f.questionCount + 1 }));
  }

  for (const b of (bookings.data ?? []) as Array<{
    tenant_id: string;
    created_at: string;
    email_status: string | null;
    email_error: string | null;
    sync_status: string | null;
    sync_error: string | null;
  }>) {
    bump(b.tenant_id, (f) => {
      const emailFailed = b.email_status === 'failed';
      const syncFailed = b.sync_status === 'failed';
      return {
        ...f,
        emailsFailed: f.emailsFailed + (emailFailed ? 1 : 0),
        /* Classified here and the message dropped on the floor. This is the
           only line in the file where anything free-text is touched, and
           nothing derived from it survives the call. */
        emailErrorClasses: emailFailed
          ? [...f.emailErrorClasses, classifyError(b.email_error)]
          : f.emailErrorClasses,
        syncsFailed: f.syncsFailed + (syncFailed ? 1 : 0),
        syncErrorClasses: syncFailed
          ? [...f.syncErrorClasses, classifyError(b.sync_error)]
          : f.syncErrorClasses,
        lastBookingAt:
          !f.lastBookingAt || b.created_at > f.lastBookingAt ? b.created_at : f.lastBookingAt,
        bookingsInWindow: f.bookingsInWindow + 1,
      };
    });
  }

  for (const r of (responses.data ?? []) as Array<{ tenant_id: string; started_at: string }>) {
    bump(r.tenant_id, (f) => ({
      ...f,
      enquiriesInWindow: f.enquiriesInWindow + 1,
      lastEnquiryAt:
        !f.lastEnquiryAt || r.started_at > f.lastEnquiryAt ? r.started_at : f.lastEnquiryAt,
    }));
  }

  return facts;
}
