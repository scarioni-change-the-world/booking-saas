import { baseUrl } from '@/lib/base-url';
import { handleError, ok, readJson, requireEmail } from '@/lib/api';
import { generateRecoveryLink } from '@/lib/db';
import { sendPasswordResetEmail } from '@/lib/password-reset-email';
import { PLATFORM_SCOPE, enforceRateLimit } from '@/lib/rate-limit';

/**
 * "I've forgotten my password" — send me a link to set a new one.
 *
 * Deliberately says nothing about whether the address has an account. The
 * response is byte-identical either way, for the same reason the client-link
 * endpoint's is (see src/app/api/t/[slug]/client-link/route.ts): the
 * alternative turns a convenience into a way to ask this platform "is this
 * person one of your customers?" one address at a time. Here that question
 * is worth more to an attacker than it is there — a hit is an address with a
 * login, which is the first half of a credential-stuffing run.
 *
 * What it costs: somebody who really has forgotten their password and
 * mistypes their address gets the same reassuring message as a success, and
 * no email. That is the accepted trade, and the copy on the page is written
 * to survive it — it says "if that address has an account", not "check your
 * inbox", so a person who sees nothing arrive knows to try another address
 * rather than waiting.
 *
 * One residual signal is accepted rather than papered over, exactly as on
 * client-link: sending mail takes longer than not sending it, so response
 * time differs slightly between a hit and a miss. The limits below make
 * sampling that in bulk impractical, which is the level of answer this
 * deserves.
 *
 * SETUP NOTE, because this is the one part that fails silently and
 * confusingly: the redirect below must be on Supabase's allowed list —
 * Authentication → URL Configuration → Redirect URLs. An address that is not
 * on it makes Supabase drop the redirect and send the person to the Site URL
 * instead, where the recovery tokens land on a page that does nothing with
 * them. Nothing here can detect that, so it is written down here.
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const email = requireEmail(body, 'email');

    // Both enforced before the lookup, so neither answer reveals more than
    // the other — the timing of a refusal must not depend on whether the
    // address exists either.
    await enforceRateLimit(request, PLATFORM_SCOPE, 'passwordResetRequest');
    await enforceRateLimit(request, PLATFORM_SCOPE, 'passwordResetAddress', { subject: email });

    const link = await generateRecoveryLink(email, `${baseUrl()}/admin/reset-password`);

    if (link) {
      const status = await sendPasswordResetEmail(email, link);
      // Logged, never returned. Someone reporting "I asked twice and nothing
      // came" is diagnosed from here, not from the response they saw.
      if (status !== 'sent') {
        console.error(`[password-reset] could not send to a known address: ${status}`);
      }
    }

    return ok({
      message:
        "If that address has an intro account, we've sent it a link for setting a new password. It's good for one hour.",
    });
  } catch (error) {
    return handleError(error);
  }
}
