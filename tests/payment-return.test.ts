import { describe, expect, it } from 'vitest';
import { returnPath } from '../src/lib/payment-return';

describe('returnPath', () => {
  it('sends Stripe back to a service page or to Account, never anywhere else', () => {
    expect(returnPath('sessions/123e4567-e89b-12d3-a456-426614174000?tab=details')).toBe(
      'sessions/123e4567-e89b-12d3-a456-426614174000?tab=details',
    );
    expect(returnPath(undefined)).toBe('account');
    expect(returnPath('https://evil.example')).toBe('account');
    expect(returnPath('../../other/account')).toBe('account');
  });
});
