import { redirect } from 'next/navigation';

/**
 * "Sign in" lives at /admin/login. This address is the one people — and the
 * marketing site — are likely to guess, so it simply goes there instead of
 * answering with a page that does not exist.
 */
export default function SignInAlias(): never {
  redirect('/admin/login');
}
