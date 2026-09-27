import { baseUrl } from '@/lib/base-url';
import { fail, handleError, ok, readJson, requireEmail, requireString, requireTimezone } from '@/lib/api';
import { beginSignup, slugTaken } from '@/lib/db/signup';
import { PLATFORM_SCOPE, enforceRateLimit } from '@/lib/rate-limit';
import { signupProblem, BUSINESS_NAME_MAX, PASSWORD_MAX } from '@/lib/signup';
import { sendAlreadyRegisteredEmail, sendSignupConfirmEmail } from '@/lib/signup-email';

/**
 * Create an account: the first half of signing up.
 *
 * Makes a login that cannot be used yet and emails the link that confirms
 * it; the business is made when the link is opened (./complete). Answers
 * the same whether or not the address already has an account — an address
 * that does is told so by email instead — for the reason the password-reset
 * route gives: anything else is a way to ask which people are customers.
 *
 * A web address already taken is said plainly: which businesses exist is
 * public anyway, at /t/<address>.
 *
 * SETUP NOTE: `${baseUrl()}/admin/welcome` must be on Supabase's Redirect URLs
 * list (Authentication → URL Configuration), or the link lands on the Site
 * URL instead of finishing the signup.
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const businessName = requireString(body, 'businessName', { maxLength: BUSINESS_NAME_MAX });
    const slug = requireString(body, 'slug', { maxLength: 60 }).toLowerCase();
    const email = requireEmail(body, 'email');
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length > PASSWORD_MAX * 4) return fail('That password is too long.', 400);
    const timezone = requireTimezone(body, 'timezone');

    const problem = signupProblem({ businessName, slug, email, password });
    if (problem) return fail(problem, 400);

    await enforceRateLimit(request, PLATFORM_SCOPE, 'signupRequest');
    await enforceRateLimit(request, PLATFORM_SCOPE, 'signupAddress', { subject: email });

    if (await slugTaken(slug)) return fail('A business already has that web address. Choose another.', 409);

    const started = await beginSignup({
      email,
      password,
      business: { name: businessName, slug, timezone },
      redirectTo: `${baseUrl()}/admin/welcome`,
    });

    const status =
      started.kind === 'confirm'
        ? await sendSignupConfirmEmail(email, businessName, started.link)
        : await sendAlreadyRegisteredEmail(email, `${baseUrl()}/admin/login`);
    // Logged, never returned: the answer must not differ between the two.
    if (status !== 'sent') console.error(`[signup] email to a new sign-up was not sent: ${status}`);

    return ok({ email });
  } catch (error) {
    return handleError(error);
  }
}
