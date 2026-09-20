import { __unsafeServiceClient } from './client';

/**
 * Whether the database has had every migration in this repository run
 * against it.
 *
 * This project has no migration runner: Vercel ships the application, and
 * the SQL in supabase/migrations is applied by hand in Supabase's editor.
 * When the two fall out of step the new code calls something that isn't
 * there, and the symptom — handleError's generic "Something went wrong" —
 * is by design useless for diagnosis. So the gap is detected on purpose
 * instead of discovered by accident.
 *
 * See migration 0022 for the table this reads.
 */

/**
 * Every migration this code expects, in order.
 *
 * Hand-maintained, and deliberately so: reading the directory at runtime is
 * not an option on a serverless host, where only what the bundler traced
 * gets deployed. What keeps it honest is tests/migrations.test.ts, which
 * reads supabase/migrations itself and fails if this list has drifted — so
 * adding a migration without registering it here breaks the suite rather
 * than the deployment.
 */
export const EXPECTED_MIGRATIONS = [
  '0001_tenancy',
  '0002_booking_core',
  '0003_qualification',
  '0004_bookings',
  '0005_rls',
  '0006_calendar_connections',
  '0007_service_role_grants',
  '0008_revoke_anon',
  '0009_platform_staff',
  '0010_clients',
  '0011_outcome_paths',
  '0012_response_lifecycle',
  '0013_booking_mode',
  '0014_pack_size_ceiling',
  '0015_ai_usage',
  '0016_question_scoping',
  '0017_email',
  '0018_trial_gate',
  '0019_rate_limits',
  '0020_client_invite',
  '0021_auth_user_lookup',
  '0022_schema_migrations',
  '0023_booking_reminder',
] as const;

/**
 * The migration that introduced the tracking table itself.
 *
 * Needed because its absence is meaningful rather than an error: a database
 * with no schema_migrations table is not a database with no migrations, it
 * is one that stopped just before this file. Everything earlier must have
 * run — the application was working — so only this and anything after it can
 * be outstanding. Getting that wrong would greet a perfectly healthy
 * deployment with twenty-two phantom pending migrations.
 */
const TRACKING_STARTS_AT = '0022_schema_migrations';

export interface SchemaState {
  /** How many of the expected migrations the database reports having. */
  applied: number;
  expected: number;
  /** Named, in order, so the answer is "run these two files" not "you are behind". */
  pending: string[];
  /**
   * Null when the comparison itself succeeded. Set when the database could
   * not be asked at all, which is a different thing from being behind and
   * must not be reported as either up to date or lagging.
   */
  error: string | null;
}

export async function schemaState(): Promise<SchemaState> {
  const expected = EXPECTED_MIGRATIONS.length;

  const { data, error } = await __unsafeServiceClient()
    .from('schema_migrations')
    .select('version');

  let applied: Set<string>;

  if (error) {
    // 42P01 is undefined_table. PostgREST also answers PGRST205 for a
    // relation missing from its schema cache, which is the same situation
    // seen through a different layer.
    const missingTable = error.code === '42P01' || error.code === 'PGRST205';
    if (!missingTable) {
      return { applied: 0, expected, pending: [], error: error.message };
    }
    applied = new Set(EXPECTED_MIGRATIONS.filter((v) => v < TRACKING_STARTS_AT));
  } else {
    applied = new Set((data ?? []).map((row) => (row as { version: string }).version));
  }

  const pending = EXPECTED_MIGRATIONS.filter((version) => !applied.has(version));

  return {
    // Counted against what this code expects, not against what the table
    // holds: a database carrying migrations from a newer deployment than
    // this one should not report more applied than exist.
    applied: expected - pending.length,
    expected,
    pending,
    error: null,
  };
}
