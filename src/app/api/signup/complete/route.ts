import { fail, handleError, ok } from '@/lib/api';
import { requireSignedInUser, resolveTenantMemberships } from '@/lib/auth';
import { finishSignup } from '@/lib/db/signup';
import { readPendingBusiness } from '@/lib/signup';
import { sendNewSignupAlert } from '@/lib/signup-email';

/**
 * The confirmation link was opened (or, on a project that confirms addresses
 * by itself, the person signed in): make the business the form asked for.
 *
 * Idempotent. Somebody who already belongs to a business is sent to it; a
 * login with nothing waiting on it gets a 404, which the sign-in page reads
 * as "not linked to a business".
 */
export async function POST(request: Request) {
  try {
    const user = await requireSignedInUser(request);

    const memberships = await resolveTenantMemberships(request);
    if (memberships.length > 0) return ok({ slug: memberships[0]!.slug, created: false });

    const pending = readPendingBusiness(user.user_metadata);
    if (!pending) return fail('Nothing to finish', 404);
    if (!user.email_confirmed_at) return fail('Confirm your email first — the link is in your inbox.', 403);

    const tenant = await finishSignup(user, pending);
    await sendNewSignupAlert(tenant, user.email ?? 'an unknown address');
    return ok({ slug: tenant.slug, created: true }, 201);
  } catch (error) {
    return handleError(error);
  }
}
