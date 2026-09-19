import { NextResponse } from 'next/server';
import { resolveTenantBySlug } from '@/lib/db';

/**
 * Is this deployment configured, and can it reach its database?
 *
 * Exists because "Something went wrong" — the deliberately generic 500 that
 * handleError returns so internals never leak to a caller — is the right
 * answer for a stranger and a useless one for whoever just deployed this.
 * The real exception goes to the host's logs, but reading those is a
 * detour when the question is almost always "which variable did I miss".
 *
 * Deliberately reports no values. Every configuration answer here is a
 * boolean: whether something is set, never what it is set to. Nothing in
 * the response names a host, a key, an address or a fragment of one, so
 * this reveals nothing an attacker could not already infer from the app
 * being up or down — while still naming exactly which piece is missing for
 * the person who can fix it.
 *
 * The database check runs a real query through the same path the app uses
 * (resolveTenantBySlug), rather than merely checking that the variables
 * are non-empty. A key that is present but wrong is the more common
 * failure, and only a round trip catches it.
 */

function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

export async function GET() {
  const config = {
    supabaseUrl: isSet(process.env.SUPABASE_URL),
    supabaseServiceRoleKey: isSet(process.env.SUPABASE_SERVICE_ROLE_KEY),
    supabaseAnonKey: isSet(process.env.SUPABASE_ANON_KEY),
    // These two are inlined into the browser bundle at build time, so they
    // are the ones that stay missing after a host-side change until a
    // rebuild happens. Named separately for exactly that reason.
    publicSupabaseUrl: isSet(process.env.NEXT_PUBLIC_SUPABASE_URL),
    publicSupabaseAnonKey: isSet(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    appSecret: isSet(process.env.APP_SECRET),
    appSecretLongEnough: (process.env.APP_SECRET ?? '').length >= 32,
    // Optional. Absent means a documented fallback, not a fault: no SMTP
    // logs mail to the console instead of sending, no Google means calendar
    // sync is simply off, and no base URL falls back to the host's own.
    publicBaseUrl: isSet(process.env.PUBLIC_BASE_URL),
    smtp: isSet(process.env.SMTP_HOST),
    google: isSet(process.env.GOOGLE_CLIENT_ID) && isSet(process.env.GOOGLE_CLIENT_SECRET),
  };

  let database: { reachable: boolean; error: string | null };
  try {
    // A slug nothing will ever own. Resolving to null is success: it means
    // the query ran and came back empty, which is the whole round trip.
    await resolveTenantBySlug('__health_check_no_such_tenant__');
    database = { reachable: true, error: null };
  } catch (cause) {
    // The one place a provider's own words are echoed to a caller, and it
    // is a deliberate exception to the rule the rest of this codebase
    // keeps: this endpoint exists to be read by the person deploying, and
    // "Invalid API key" versus "fetch failed" is the entire difference
    // between a wrong key and an unreachable host. It is a connection
    // error from the database client, which carries no row data.
    console.error('[health] database unreachable:', cause);
    database = { reachable: false, error: (cause as Error).message.slice(0, 200) };
  }

  const ready =
    config.supabaseUrl &&
    config.supabaseServiceRoleKey &&
    config.publicSupabaseUrl &&
    config.publicSupabaseAnonKey &&
    database.reachable;

  return NextResponse.json({ ready, config, database }, { status: ready ? 200 : 503 });
}
