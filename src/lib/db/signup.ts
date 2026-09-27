import type { User } from '@supabase/supabase-js';
import { BookingError } from '../booking-service';
import { slugCandidates, type PendingBusiness } from '../signup';
import { __unsafeServiceClient } from './client';
import { createTenant } from './console';
import type { TenantRow } from './types';

/**
 * Self-serve signup, the database half. Service-role, like every write that
 * creates a business (see console.ts): nobody is signed in yet when the form
 * is sent, and when the link is opened the person is proven by Supabase's
 * own token, checked before anything here runs.
 */

/** Whether a business already has this web address. */
export async function slugTaken(slug: string): Promise<boolean> {
  const { data, error } = await __unsafeServiceClient()
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export type SignupStart =
  /** A link to open, for a new address — or one that never finished signing up. */
  | { kind: 'confirm'; link: string }
  /** The address already has a working login. Nothing is created or changed. */
  | { kind: 'exists' };

/**
 * The form was sent. Create a login that cannot be used until the address is
 * confirmed, and return the link that confirms it — Supabase generates it
 * here without sending anything, so the email that carries it is intro's own.
 *
 * An address that started signing up and never confirmed starts again: the
 * new password and business replace the old ones. Until the link is opened
 * nobody has proved the address is theirs, so there is nothing to protect.
 */
export async function beginSignup(input: {
  email: string;
  password: string;
  business: PendingBusiness;
  redirectTo: string;
}): Promise<SignupStart> {
  const client = __unsafeServiceClient();
  const data = { pending_business: input.business };

  const { data: existingId, error: lookupError } = await client.rpc('auth_user_id_by_email', {
    p_email: input.email,
  });
  if (lookupError) throw lookupError;

  if (existingId) {
    const { data: found, error } = await client.auth.admin.getUserById(existingId as string);
    if (error) throw error;
    if (found.user?.email_confirmed_at) return { kind: 'exists' };

    const updated = await client.auth.admin.updateUserById(existingId as string, {
      password: input.password,
      user_metadata: data,
    });
    if (updated.error) throw updated.error;
    // A magic link confirms the address when it is opened, the same as a
    // signup link — which Supabase will not make twice for one address.
    const link = await client.auth.admin.generateLink({
      type: 'magiclink',
      email: input.email,
      options: { redirectTo: input.redirectTo },
    });
    if (link.error) throw link.error;
    return { kind: 'confirm', link: requireLink(link.data?.properties?.action_link) };
  }

  const { data: made, error } = await client.auth.admin.generateLink({
    type: 'signup',
    email: input.email,
    password: input.password,
    options: { data, redirectTo: input.redirectTo },
  });
  if (error) throw error;
  return { kind: 'confirm', link: requireLink(made?.properties?.action_link) };
}

function requireLink(link: string | undefined): string {
  if (!link) throw new Error('Supabase returned no action link for signup');
  return link;
}

/**
 * The link was opened: make the business, with this person as its owner.
 *
 * Its web address is the one they chose, or the next free numbered one if a
 * business took it in the meantime. Safe to call twice — somebody opening the
 * link in two tabs gets the one business, not two.
 */
export async function finishSignup(user: User, business: PendingBusiness): Promise<TenantRow> {
  const client = __unsafeServiceClient();

  for (const slug of slugCandidates(business.slug)) {
    try {
      const tenant = await createTenant({
        slug,
        name: business.name,
        timezone: business.timezone,
        ownerEmail: user.email!,
        owner: { userId: user.id, email: user.email ?? null },
      });
      // Done: nothing is waiting any more, so a second tab finds nothing to make.
      const cleared = await client.auth.admin.updateUserById(user.id, {
        user_metadata: { ...(user.user_metadata ?? {}), pending_business: null },
      });
      if (cleared.error) console.error('[signup] could not clear the pending business:', cleared.error);
      return tenant;
    } catch (cause) {
      if (cause instanceof BookingError && cause.status === 409) continue;
      throw cause;
    }
  }
  throw new BookingError('Every version of that web address is taken. Sign up again with another one.', 409);
}
