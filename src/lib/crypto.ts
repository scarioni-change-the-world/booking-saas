import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';

/**
 * Symmetric encryption for stored OAuth credentials, and HMAC signing for
 * OAuth state.
 *
 * A tenant's Google refresh token is a long-lived grant over their calendar.
 * service_role can read every row of calendar_connections, so a plaintext
 * column would turn any database dump into a set of live mailbox grants. These
 * are encrypted with AES-256-GCM, which authenticates as well as encrypts —
 * a tampered ciphertext fails to decrypt rather than yielding garbage.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function secret(): string {
  const value = process.env.APP_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      'APP_SECRET must be set to at least 32 characters. Generate one with: openssl rand -base64 32',
    );
  }
  return value;
}

/**
 * Derive a fixed-length key from APP_SECRET.
 *
 * SHA-256 rather than a password KDF on purpose: APP_SECRET is a
 * machine-generated high-entropy value, not a user password, so key stretching
 * buys nothing and would cost a derivation on every request.
 */
function key(): Buffer {
  return createHash('sha256').update(secret()).digest();
}

/** Encrypt to `iv.ciphertext.tag`, all base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

/**
 * Decrypt a value produced by encryptSecret.
 *
 * Throws on a tampered or truncated value rather than returning anything —
 * a corrupted refresh token must surface as a broken connection the tenant is
 * told to reconnect, never as a silent auth failure against Google.
 */
export function decryptSecret(encoded: string): string {
  const parts = encoded.split('.');
  if (parts.length !== 3) throw new Error('Malformed encrypted value');

  const iv = Buffer.from(parts[0]!, 'base64url');
  const ciphertext = Buffer.from(parts[1]!, 'base64url');
  const tag = Buffer.from(parts[2]!, 'base64url');

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Malformed encrypted value');
  }

  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Sign an OAuth `state` payload.
 *
 * state carries the tenant the callback should attach the connection to. Left
 * unsigned, anyone could hand a victim a start URL naming their own tenant and
 * capture the resulting grant — or point a legitimate grant at a tenant they
 * control. The signature makes state unforgeable, and the embedded timestamp
 * bounds how long a start URL stays usable.
 */
export function signState(payload: Record<string, unknown>, ttlSeconds = 600): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  ).toString('base64url');

  const signature = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

/** Verify and decode a signed state value, or return null. */
export function verifyState<T = Record<string, unknown>>(state: string): T | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;

  const [body, signature] = parts as [string, string];
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');

  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload as T;
  } catch {
    return null;
  }
}
