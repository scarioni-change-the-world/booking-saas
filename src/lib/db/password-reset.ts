import { __unsafeServiceClient } from './client';

/**
 * Minting a password-recovery link.
 *
 * Lives in src/lib/db because it needs the service-role client: only
 * service_role may call auth.admin, and the rule that nothing outside this
 * directory touches that client is what makes the rule worth anything.
 *
 * Existence is checked through auth_user_id_by_email (migration 0021)
 * before generateLink is asked for anything, rather than by reading the
 * error generateLink returns for an unknown address. Two reasons, and the
 * second is the real one:
 *
 *   - Branching on an error *message* means a Supabase release that rewords
 *     "User not found" turns a silent miss into a 500. The RPC returns a
 *     value, not prose.
 *   - The caller answers identically whether or not the address exists (see
 *     the route), and it can only do that if "no such user" is an ordinary
 *     return rather than something thrown.
 */
export async function generateRecoveryLink(
  email: string,
  redirectTo: string,
): Promise<string | null> {
  const client = __unsafeServiceClient();

  const { data: userId, error: lookupError } = await client.rpc('auth_user_id_by_email', {
    p_email: email,
  });
  if (lookupError) throw lookupError;
  if (!userId) return null;

  const { data, error } = await client.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });
  if (error) throw error;

  // Generated but unreadable is a fault worth hearing about — it means the
  // shape of this response changed, not that the address was unknown.
  const link = data?.properties?.action_link;
  if (!link) throw new Error('Supabase returned no action link for a known address');

  return link;
}
