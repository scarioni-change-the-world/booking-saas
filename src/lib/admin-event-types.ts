import { BookingError } from './booking-service';
import type { BookingMode } from './db/types';

const MODES: BookingMode[] = ['single', 'pack'];
const PACK_SIZE_MIN = 2;
const PACK_SIZE_MAX = 50;

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
