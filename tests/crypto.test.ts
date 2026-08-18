import { beforeEach, describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  signState,
  verifyState,
} from '@/lib/crypto';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';

beforeEach(() => {
  process.env.APP_SECRET = SECRET;
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a refresh token', () => {
    const token = '1//0abcDEF-refresh-token_value';
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it('never stores the plaintext', () => {
    const token = 'super-secret-refresh-token';
    expect(encryptSecret(token)).not.toContain(token);
  });

  it('produces a different ciphertext each time', () => {
    // A fresh IV per encryption: identical tokens for two tenants must not
    // produce identical ciphertext, or the column leaks which rows match.
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects a tampered ciphertext rather than returning garbage', () => {
    const encrypted = encryptSecret('token');
    const [iv, ciphertext, tag] = encrypted.split('.');
    const flipped = Buffer.from(ciphertext!, 'base64url');
    flipped.writeUInt8(flipped.readUInt8(0) ^ 0xff, 0);

    expect(() =>
      decryptSecret(`${iv}.${flipped.toString('base64url')}.${tag}`),
    ).toThrow();
  });

  it('rejects a value encrypted under a different secret', () => {
    const encrypted = encryptSecret('token');
    process.env.APP_SECRET = 'a-completely-different-secret-32-chars-long';
    expect(() => decryptSecret(encrypted)).toThrow();
  });

  it('rejects a malformed value', () => {
    expect(() => decryptSecret('nonsense')).toThrow();
    expect(() => decryptSecret('a.b')).toThrow();
  });

  it('refuses to operate without a strong APP_SECRET', () => {
    process.env.APP_SECRET = 'too-short';
    expect(() => encryptSecret('token')).toThrow(/APP_SECRET/);
    delete process.env.APP_SECRET;
    expect(() => encryptSecret('token')).toThrow(/APP_SECRET/);
  });
});

describe('signState / verifyState', () => {
  it('round-trips a payload', () => {
    const state = signState({ tenantId: 'abc', slug: 'demo' });
    expect(verifyState<{ tenantId: string; slug: string }>(state)).toMatchObject({
      tenantId: 'abc',
      slug: 'demo',
    });
  });

  it('rejects a forged state', () => {
    // The attack this exists to stop: naming someone else's tenant in the
    // callback so the resulting grant attaches there.
    const body = Buffer.from(
      JSON.stringify({ tenantId: 'victim', exp: Math.floor(Date.now() / 1000) + 600 }),
    ).toString('base64url');

    expect(verifyState(`${body}.not-a-real-signature`)).toBeNull();
  });

  it('rejects a state signed with a different secret', () => {
    const state = signState({ tenantId: 'abc' });
    process.env.APP_SECRET = 'a-completely-different-secret-32-chars-long';
    expect(verifyState(state)).toBeNull();
  });

  it('rejects an expired state', () => {
    expect(verifyState(signState({ tenantId: 'abc' }, -1))).toBeNull();
  });

  it('rejects a malformed state', () => {
    expect(verifyState('')).toBeNull();
    expect(verifyState('one-part')).toBeNull();
    expect(verifyState('a.b.c')).toBeNull();
  });
});
