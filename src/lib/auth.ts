import { __unsafeServiceClient } from './db/client';
import { resolveTenantBySlug, type ResolvedTenant } from './db';
import type { MemberRole } from './db/types';

export interface TenantMembership {
  slug: string;
  name: string;
  role: MemberRole;
}

/**
 * Dashboard authentication.
 *
 * Requests arrive with a Supabase session token in the Authorization header,
 * validated against Supabase Auth exactly as the reference implementation did.
 * The token proves who the caller is; membership in `tenant_members` decides
 * what they may touch, and is checked here rather than assumed from the slug in
 * the URL — otherwise any signed-in user could administer any tenant by
 * guessing a slug.
 */

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthenticatedTenant extends ResolvedTenant {
  userId: string;
  role: MemberRole;
}

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) throw new AuthError('Sign in required', 401);
  return match[1]!;
}

/**
 * Require that the caller is an owner or admin of the tenant named in the URL.
 *
 * Connecting or disconnecting a calendar changes what the whole tenant can
 * book, so it is deliberately not open to the `member` role.
 */
export async function requireTenantAdmin(
  request: Request,
  slug: string,
): Promise<AuthenticatedTenant> {
  const token = bearerToken(request);

  const { data, error } = await __unsafeServiceClient().auth.getUser(token);
  if (error || !data.user) throw new AuthError('Sign in required', 401);

  const resolved = await resolveTenantBySlug(slug);
  // Same 404 whether the tenant does not exist or the caller cannot see it, so
  // this endpoint cannot be used to enumerate tenants.
  if (!resolved) throw new AuthError('Not found', 404);

  const membership = await __unsafeServiceClient()
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', resolved.tenant.id)
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (membership.error) throw membership.error;

  const role = (membership.data as { role: MemberRole } | null)?.role;
  if (!role) throw new AuthError('Not found', 404);
  if (role !== 'owner' && role !== 'admin') {
    throw new AuthError('You do not have permission to change this setting', 403);
  }

  return { ...resolved, userId: data.user.id, role };
}

/**
 * Which businesses a signed-in person belongs to, and what they may do there.
 *
 * Unlike requireTenantAdmin, this takes no slug — it exists for the moment
 * right after login, before the browser knows which tenant's dashboard to
 * open. A person with no memberships gets an empty list, not an error: that
 * is a legitimate state (an account exists but nobody has added them to a
 * business yet), for the caller to explain.
 */
export async function resolveTenantMemberships(request: Request): Promise<TenantMembership[]> {
  const token = bearerToken(request);

  const { data: userData, error: userError } = await __unsafeServiceClient().auth.getUser(token);
  if (userError || !userData.user) throw new AuthError('Sign in required', 401);

  const { data, error } = await __unsafeServiceClient()
    .from('tenant_members')
    .select('role, tenants(slug, name)')
    .eq('user_id', userData.user.id);

  if (error) throw error;

  return ((data ?? []) as unknown as Array<{
    role: MemberRole;
    tenants: { slug: string; name: string } | null;
  }>)
    .filter((row) => row.tenants !== null)
    .map((row) => ({ slug: row.tenants!.slug, name: row.tenants!.name, role: row.role }));
}
