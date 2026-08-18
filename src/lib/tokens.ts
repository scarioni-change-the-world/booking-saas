import { randomBytes } from 'node:crypto';

/**
 * Manage tokens.
 *
 * The token is the only credential protecting a booking (brief 2.4), so it is
 * generated from a CSPRNG, never from a timestamp, a uuid v4 rendered
 * predictable by its version bits, or anything derived from the booking itself.
 *
 * 32 bytes, base64url: 256 bits of entropy in a 43-character URL-safe string.
 */
export function generateManageToken(): string {
  return randomBytes(32).toString('base64url');
}
