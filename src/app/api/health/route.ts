import { NextResponse } from 'next/server';
import { resolveTenantBySlug } from '@/lib/db';
import { schemaState, type SchemaState } from '@/lib/db/migrations';

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
  // Which deployment is actually answering. All of it is non-sensitive and
  // set by the host itself, and it settles the question that configuration
  // booleans alone cannot: whether the variables are missing, or whether
  // the thing serving this request is not the deployment you are editing.
  //
  // vercelEnv present while everything below is false is the tell — it
  // proves the host is injecting an environment, just not one containing
  // your variables. That means wrong project, or variables scoped to an
  // environment this deployment is not in.
  //
  // commit is the other half: it says exactly which build is live, so
  // "did my redeploy actually happen" stops being a guess.
  const deployment = {
    vercelEnv: process.env.VERCEL_ENV ?? null,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    // A count, never the names: proves whether this process has an
    // environment at all without listing what is in it.
    environmentVariablesVisible: Object.keys(process.env).length,
  };

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
    // sync is simply off, no Anthropic key means the Questions tab's drafting
    // assistant says so rather than offering an empty draft, and no base URL
    // falls back to the host's own.
    publicBaseUrl: isSet(process.env.PUBLIC_BASE_URL),
    // Split, because SMTP_HOST alone is what flips the app from logging mail
    // to really sending it — while the other three are what decide whether
    // that send can succeed. One boolean covering all four would have read
    // true with three of them missing.
    smtp: isSet(process.env.SMTP_HOST),
    smtpReadyToSend:
      isSet(process.env.SMTP_HOST) &&
      isSet(process.env.SMTP_USER) &&
      isSet(process.env.SMTP_PASSWORD) &&
      isSet(process.env.EMAIL_FROM_ADDRESS) &&
      // The placeholder from .env.example. Present but unchanged is the same
      // as absent, and harder to notice.
      !/@example\.com$/i.test(process.env.EMAIL_FROM_ADDRESS!.trim()),
    google: isSet(process.env.GOOGLE_CLIENT_ID) && isSet(process.env.GOOGLE_CLIENT_SECRET),
    anthropic: isSet(process.env.ANTHROPIC_API_KEY),
    // Without this the reminder endpoint disables itself and answers 503,
    // which is the correct failure but a silent one from the outside: no
    // reminders go out and nothing says why. Reported here so "is the
    // scheduler going to work" is one request rather than a wait and a
    // guess.
    cronSecret: isSet(process.env.CRON_SECRET),
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

  // Is the database as far along as this code expects? There is no migration
  // runner here — the SQL in supabase/migrations is applied by hand — so a
  // deploy can land needing a migration nobody has run. The symptom is a
  // generic 500 from whatever calls the missing thing, which says nothing;
  // this names the files.
  let schema: SchemaState;
  if (database.reachable) {
    try {
      schema = await schemaState();
    } catch (cause) {
      console.error('[health] could not read schema state:', cause);
      schema = {
        applied: 0,
        expected: 0,
        pending: [],
        error: (cause as Error).message.slice(0, 200),
      };
    }
  } else {
    // Asking would only produce a second copy of the same connection error.
    schema = { applied: 0, expected: 0, pending: [], error: 'database unreachable' };
  }

  const ready =
    config.supabaseUrl &&
    config.supabaseServiceRoleKey &&
    config.publicSupabaseUrl &&
    config.publicSupabaseAnonKey &&
    database.reachable &&
    // A deployment running ahead of its database is not ready, even though
    // most of it works. Most of it working is exactly what makes this kind of
    // gap take an afternoon to find.
    schema.pending.length === 0 &&
    schema.error === null;

  return NextResponse.json(
    { ready, deployment, config, database, schema },
    { status: ready ? 200 : 503 },
  );
}
