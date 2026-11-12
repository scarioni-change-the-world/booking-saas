/**
 * The rules for somebody creating their own business on khloe — pure, so the
 * sign-up page and the route give the same answers.
 *
 * Signing up is two steps, and the gap between them is the point: the form
 * creates a login that cannot be used yet and emails a link; the business
 * itself is only made once that link is opened, so every business on the
 * platform belongs to an address somebody can actually read. What the form
 * asked for waits on the login in the meantime (`pending_business`).
 */

export const PASSWORD_MIN = 8;
/** Supabase hashes with bcrypt, which reads no further than 72 bytes. */
export const PASSWORD_MAX = 72;
export const BUSINESS_NAME_MAX = 200;

export interface PendingBusiness {
  name: string;
  slug: string;
  timezone: string;
}

/**
 * Web addresses no business may have: they read as part of khloe itself,
 * or would confuse support ("go to app.khloe.io/admin"). Every top-level
 * route of the app is here too, since a booking page now lives at the root
 * (app.khloe.io/<slug>, see proxy.ts).
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // The app's own routes (proxy.ts) and pages.
  'admin', 'api', 'app', 'console', 'embed', 'login', 'logout', 'manage', 'paid', 'privacy', 'rate',
  'signin', 'sign-in', 'signout', 'sign-out', 'signup', 'sign-up', 'register', 't', 'terms',
  // What reads as khloe itself, or as a page a visitor would expect from it.
  'about', 'account', 'accounts', 'assets', 'auth', 'billing', 'blog', 'book', 'booking', 'bookings',
  'careers', 'cdn', 'contact', 'dashboard', 'demo', 'docs', 'email', 'faq', 'features', 'hello', 'help',
  'hi', 'home', 'images', 'img', 'intro', 'jobs', 'khloe', 'legal', 'mail', 'news', 'oauth', 'official',
  'press', 'pricing', 'public', 'robots', 'security', 'settings', 'sitemap', 'static', 'status', 'stripe',
  'support', 'team', 'test', 'www',
  // Addresses mail systems and abuse reports expect to belong to the operator.
  'abuse', 'postmaster', 'root', 'staff', 'webmaster',
]);

/**
 * Addresses that would pass for khloe's own: "khloe" with a word or number
 * that makes it look official ("khloe-io", "khloe-support", "khloeapp",
 * "official-khloe", "khloe-2"). A business that happens to share the name
 * (Khloé is a first name) can still have "khloe-coaching" or
 * "khloe-smith-photo".
 */
const LOOKS_LIKE_KHLOE =
  /^(?:(?:official|team|support|help|admin|staff|the|get|try|my|hello|hi)-?)?khloe(?:-?(?:io|app|hq|team|official|support|help|admin|staff|billing|bookings?|mail|email|news|blog|status|security|legal|privacy|demo|test|\d+))?$/;

/** Whether an address is kept for khloe itself. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug) || LOOKS_LIKE_KHLOE.test(slug);
}

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !slug.includes('--') && !isReservedSlug(slug);
}

/**
 * A web address from a business's name: "Estudio Núñez & Co." becomes
 * "estudio-nunez-co". Accents are folded rather than dropped, so a Spanish
 * or French name stays recognisable. Empty when nothing usable is left.
 */
export function slugFromName(name: string): string {
  const folded = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let slug = folded.slice(0, 50).replace(/-+$/g, '');
  if (slug.length > 0 && slug.length < 3) slug = `${slug}-studio`;
  return slug;
}

/** The address itself, then numbered ones, for when it is taken. */
export function slugCandidates(base: string, count = 9): string[] {
  const trimmed = base.slice(0, 47).replace(/-+$/g, '');
  return [base, ...Array.from({ length: count - 1 }, (_, i) => `${trimmed}-${i + 2}`)].filter(isValidSlug);
}

export interface SignupForm {
  businessName: string;
  slug: string;
  email: string;
  password: string;
}

/** Why the form cannot be sent, or null. The route refuses the same things. */
export function signupProblem(form: SignupForm): string | null {
  if (!form.businessName.trim()) return 'What is your business called?';
  if (form.businessName.trim().length > BUSINESS_NAME_MAX) return 'That name is too long.';
  if (!isValidSlug(form.slug)) {
    return isReservedSlug(form.slug)
      ? 'That web address is kept for khloe itself. Choose another.'
      : 'A web address uses lowercase letters, numbers and single dashes, at least 3 characters.';
  }
  if (!/^[^\s@,;:<>]+@[^\s@,;:<>]+\.[^\s@,;:<>]+$/.test(form.email.trim())) {
    return 'That email address does not look right.';
  }
  if (form.password.length < PASSWORD_MIN)
    return `Please use at least ${PASSWORD_MIN} characters for your password.`;
  if (new TextEncoder().encode(form.password).length > PASSWORD_MAX) return 'That password is too long.';
  return null;
}

/** What waits on a login between the form and the link, read back safely. */
export function readPendingBusiness(metadata: unknown): PendingBusiness | null {
  const pending = (metadata as { pending_business?: unknown } | null)?.pending_business as
    | Partial<PendingBusiness>
    | null
    | undefined;
  if (!pending || typeof pending !== 'object') return null;
  const { name, slug, timezone } = pending;
  if (typeof name !== 'string' || !name.trim()) return null;
  if (typeof slug !== 'string' || !isValidSlug(slug)) return null;
  if (typeof timezone !== 'string' || !timezone) return null;
  return { name: name.trim().slice(0, BUSINESS_NAME_MAX), slug, timezone };
}
