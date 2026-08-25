import { NextResponse } from 'next/server';
import { AuthError } from './auth';
import { BookingError } from './booking-service';
import { CalendarUnavailableError } from './calendar';
import { QualificationError } from './qualification';
import { resolveTenantBySlug, type ResolvedTenant } from './db';

/** Standard JSON error body. */
export function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function ok<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * Resolve a tenant from a route param, or produce the 404 response.
 *
 * A missing tenant and a suspended one both return the same 404. Distinguishing
 * them would let anyone enumerate which businesses have lapsed.
 */
export async function requireTenant(
  slug: string,
): Promise<ResolvedTenant | NextResponse> {
  const resolved = await resolveTenantBySlug(slug);
  return resolved ?? fail('Not found', 404);
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

/**
 * Turn a thrown error into a response.
 *
 * CalendarUnavailableError becomes a 503 rather than a 500 — it is explicitly a
 * temporary refusal to serve unchecked times (brief 6.8), and the client copy
 * should say "temporarily unavailable", not "something went wrong". The detail
 * is logged, never returned: internal messages can carry tenant slugs and
 * provider errors.
 */
export function handleError(error: unknown) {
  if (error instanceof AuthError) return fail(error.message, error.status);
  if (error instanceof BookingError) return fail(error.message, error.status);
  if (error instanceof QualificationError) return fail(error.message, 400);

  if (error instanceof CalendarUnavailableError) {
    console.error('[calendar] unavailable, refusing to serve slots:', error.message);
    return fail('Booking is temporarily unavailable. Please try again shortly.', 503);
  }

  console.error('[api] unhandled error:', error);
  return fail('Something went wrong', 500);
}

/** Read and validate a JSON body, rejecting anything that is not an object. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BookingError('Expected a JSON object', 400);
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BookingError) throw error;
    throw new BookingError('Invalid JSON body', 400);
  }
}

export function requireString(
  body: Record<string, unknown>,
  key: string,
  { maxLength = 2000 }: { maxLength?: number } = {},
): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BookingError(`Missing "${key}"`, 400);
  }
  if (value.length > maxLength) {
    throw new BookingError(`"${key}" is too long`, 400);
  }
  return value.trim();
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
  { maxLength = 2000 }: { maxLength?: number } = {},
): string | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new BookingError(`"${key}" must be a string`, 400);
  if (value.length > maxLength) throw new BookingError(`"${key}" is too long`, 400);
  return value.trim();
}

/**
 * A nullable field, for a PATCH where the caller must be able to clear a
 * value, not just change it — `optionalString` cannot do this, because it
 * treats an omitted key and an empty string the same way ("leave it alone"),
 * so there is no way to ask it for "blank this out".
 *
 * Returns `undefined` when the key is genuinely absent (leave unchanged),
 * `null` when the caller sent `null` or `''` (clear it), or the validated
 * string otherwise.
 */
export function optionalNullableString(
  body: Record<string, unknown>,
  key: string,
  { maxLength = 2000 }: { maxLength?: number } = {},
): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new BookingError(`"${key}" must be a string`, 400);
  if (value.length > maxLength) throw new BookingError(`"${key}" is too long`, 400);
  return value.trim();
}

/** A whole number within an inclusive range, e.g. a duration in minutes. */
export function requireInt(
  body: Record<string, unknown>,
  key: string,
  { min = -Infinity, max = Infinity }: { min?: number; max?: number } = {},
): number {
  const value = body[key];
  const num = typeof value === 'number' ? value : Number(value);
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new BookingError(`Missing "${key}"`, 400);
  }
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new BookingError(`"${key}" must be a whole number between ${min} and ${max}`, 400);
  }
  return num;
}

/** A wall-clock time as "HH:MM" or "HH:MM:SS" — what a Postgres `time` column accepts. */
export function requireTime(body: Record<string, unknown>, key: string): string {
  const value = requireString(body, key, { maxLength: 8 });
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)) {
    throw new BookingError(`"${key}" must be a time like "09:00"`, 400);
  }
  return value;
}

/** A boolean toggle. Missing means "leave unchanged" — see the callers. */
export function optionalBoolean(
  body: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new BookingError(`"${key}" must be true or false`, 400);
  return value;
}

/**
 * Validate an email address well enough to reject an obvious mistake.
 *
 * Deliberately permissive: the only authoritative test of an address is
 * delivery, and an over-strict pattern rejects valid addresses. This catches
 * typos and refuses header-injection attempts.
 */
export function requireEmail(body: Record<string, unknown>, key: string): string {
  const value = requireString(body, key, { maxLength: 320 });
  if (!/^[^\s@,;:<>]+@[^\s@,;:<>]+\.[^\s@,;:<>]+$/.test(value)) {
    throw new BookingError('That email address does not look right', 400);
  }
  return value.toLowerCase();
}

/**
 * A business's web address, e.g. "acme-coaching". Checked here too, not just
 * left to the database's own tenants_slug_format constraint (migration
 * 0001) — that constraint exists either way as the last line of defence, but
 * catching it here means a bad slug reads as "letters, numbers and dashes
 * only" instead of a raw Postgres constraint-violation message.
 */
export function requireSlug(body: Record<string, unknown>, key: string): string {
  const value = requireString(body, key, { maxLength: 50 });
  if (!/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(value)) {
    throw new BookingError(
      `"${key}" must be lowercase letters, numbers and dashes, at least 3 characters, and can't start or end with a dash`,
      400,
    );
  }
  return value;
}

/**
 * An IANA time zone name, e.g. "America/New_York" — checked against the
 * runtime's own list rather than a hand-maintained one, so it can never drift
 * out of date with reality.
 */
export function requireTimezone(body: Record<string, unknown>, key: string): string {
  const value = requireString(body, key, { maxLength: 100 });
  if (!Intl.supportedValuesOf('timeZone').includes(value)) {
    throw new BookingError(`"${key}" isn't a recognised time zone`, 400);
  }
  return value;
}
