import { BookingError } from './booking-service';
import type { BookingMode, ServiceLocationKind } from './db/types';

const LOCATION_KINDS: ServiceLocationKind[] = ['online', 'in_person', 'phone'];

const MODES: BookingMode[] = ['single', 'pack'];
const PACK_SIZE_MIN = 2;
/** "Booking packs of up to ten bookings" — the digital brand kit's own
 * product-interface spec. Migration 0013 shipped with a looser range
 * (2-50, this file's original guess); migration 0014 tightens the DB
 * constraint to match once the real ceiling was known — see its comment
 * for why that's a new migration rather than an edit to 0013. */
const PACK_SIZE_MAX = 10;

export interface BookingModeInput {
  bookingMode: BookingMode;
  packSize: number | null;
}

function requireModeValue(value: unknown): BookingMode {
  if (typeof value !== 'string' || !MODES.includes(value as BookingMode)) {
    throw new BookingError('"bookingMode" must be "single" or "pack"', 400);
  }
  return value as BookingMode;
}

function resolvePackSize(bookingMode: BookingMode, body: Record<string, unknown>): BookingModeInput {
  if (bookingMode === 'single') {
    if (body.packSize !== undefined && body.packSize !== null) {
      throw new BookingError('"packSize" is only used when bookingMode is "pack"', 400);
    }
    return { bookingMode, packSize: null };
  }

  const raw = body.packSize;
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(num) || num < PACK_SIZE_MIN || num > PACK_SIZE_MAX) {
    throw new BookingError(
      `"packSize" must be a whole number between ${PACK_SIZE_MIN} and ${PACK_SIZE_MAX}`,
      400,
    );
  }
  return { bookingMode, packSize: num };
}

/** For POST — nothing said means "single", the plain, unaffected default. */
export function parseBookingModeForCreate(body: Record<string, unknown>): BookingModeInput {
  const bookingMode = body.bookingMode === undefined ? 'single' : requireModeValue(body.bookingMode);
  return resolvePackSize(bookingMode, body);
}

/**
 * For PATCH — a partial update, so "neither field sent" has to mean "leave
 * this alone" (returns undefined). "Only one of the two sent" can't be
 * resolved without re-reading the row's current mode, which this route
 * doesn't otherwise do, so it's rejected outright rather than guessed at —
 * same reasoning as migration 0012's response_completion_paired constraint:
 * a half-changed pair is worse than an explicit error. The caller sends
 * both fields together whenever it changes either one.
 */
export function parseBookingModeForUpdate(
  body: Record<string, unknown>,
): BookingModeInput | undefined {
  const hasMode = body.bookingMode !== undefined;
  const hasSize = body.packSize !== undefined && body.packSize !== null;

  if (!hasMode && !hasSize) return undefined;

  // packSize with no bookingMode is the one genuinely ambiguous case: is
  // this switching the session to "pack", or resizing an existing pack?
  // bookingMode alone is fine either way — 'single' needs no size, and
  // 'pack' with no size falls through to resolvePackSize's own error below.
  if (!hasMode && hasSize) {
    throw new BookingError('"bookingMode" must be sent along with "packSize"', 400);
  }

  const bookingMode = requireModeValue(body.bookingMode);
  return resolvePackSize(bookingMode, body);
}

/**
 * A price, out of a request body, in minor units.
 *
 * Sent as a number of minor units rather than as text: parsing "60,50" is
 * the browser's job (see parseOptionalMoney, which the form uses), and by
 * the time a value reaches an API it should already be the integer the
 * column stores. Accepting a string here would put two parsers in the
 * codebase, and the second one would be the one that rounds differently.
 *
 * Returns undefined when the field was not sent at all, which a PATCH reads
 * as "leave this alone"; null is an explicit "no published price".
 */
export function parsePrice(body: Record<string, unknown>): number | null | undefined {
  if (body.priceMinor === undefined) return undefined;
  if (body.priceMinor === null) return null;

  const value = body.priceMinor;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > PRICE_MAX_MINOR) {
    throw new BookingError(
      '"priceMinor" must be a whole number of minor units, or null for no price',
      400,
    );
  }
  return value as number;
}

/** Matches migration 0024's range check — high enough for any real
 * appointment, low enough to catch a misplaced decimal point. */
export const PRICE_MAX_MINOR = 100_000_000;

export interface LocationInput {
  locationKind: ServiceLocationKind | null;
  locationDetail: string | null;
}

export const LOCATION_DETAIL_MAX = 300;

/**
 * Read a location out of a request body.
 *
 * Returns undefined when neither field was sent, which a PATCH reads as
 * "leave this alone" — the same shape parseBookingModeForUpdate uses, and
 * for the same reason: a partial update must be able to say nothing about a
 * field it is not touching.
 *
 * The two fields are read together rather than independently. Sending only
 * a detail would otherwise attach an address to whatever kind happened to
 * be stored, which is how a business ends up publishing a street address
 * under the word "Online".
 */
export function parseLocation(body: Record<string, unknown>): LocationInput | undefined {
  const hasKind = body.locationKind !== undefined;
  const hasDetail = body.locationDetail !== undefined;
  if (!hasKind && !hasDetail) return undefined;

  const rawKind = body.locationKind;
  let locationKind: ServiceLocationKind | null;

  if (rawKind === null || rawKind === '') {
    locationKind = null;
  } else if (typeof rawKind === 'string' && LOCATION_KINDS.includes(rawKind as ServiceLocationKind)) {
    locationKind = rawKind as ServiceLocationKind;
  } else if (!hasKind) {
    throw new BookingError('Send "locationKind" whenever you send "locationDetail"', 400);
  } else {
    throw new BookingError('"locationKind" must be online, in_person, phone or null', 400);
  }

  const rawDetail = body.locationDetail;
  let locationDetail: string | null = null;

  if (rawDetail !== undefined && rawDetail !== null) {
    if (typeof rawDetail !== 'string') {
      throw new BookingError('"locationDetail" must be text', 400);
    }
    const trimmed = rawDetail.trim();
    if (trimmed.length > LOCATION_DETAIL_MAX) {
      throw new BookingError(
        `"locationDetail" must be ${LOCATION_DETAIL_MAX} characters or fewer`,
        400,
      );
    }
    locationDetail = trimmed === '' ? null : trimmed;
  }

  // Clearing the kind clears the detail with it, rather than leaving an
  // orphan the database would refuse anyway.
  if (locationKind === null) return { locationKind: null, locationDetail: null };

  return { locationKind, locationDetail };
}

