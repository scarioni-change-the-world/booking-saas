import { describe, expect, it } from 'vitest';
import {
  isValidSlug,
  readPendingBusiness,
  signupProblem,
  slugCandidates,
  slugFromName,
} from '../src/lib/signup';

describe('slugFromName', () => {
  it('folds accents and joins words with single dashes', () => {
    expect(slugFromName('Estudio Núñez & Co.')).toBe('estudio-nunez-and-co');
    expect(slugFromName('  Mara   Studio!! ')).toBe('mara-studio');
    expect(slugFromName('Café Crème')).toBe('cafe-creme');
  });

  it('pads a name too short to be an address, and gives up on nothing usable', () => {
    expect(slugFromName('Jo')).toBe('jo-studio');
    expect(slugFromName('日本')).toBe('');
  });

  it('never ends on a dash after trimming to length', () => {
    const slug = slugFromName('a'.repeat(49) + ' b');
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(50);
  });
});

describe('isValidSlug', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidSlug('mara-studio')).toBe(true);
    expect(isValidSlug('abc')).toBe(true);
  });

  it('refuses the malformed and the reserved', () => {
    for (const slug of ['ab', '-abc', 'abc-', 'a--b', 'Mara', 'mara studio', 'admin', 'console', 'signup']) {
      expect(isValidSlug(slug)).toBe(false);
    }
  });
});

describe('slugCandidates', () => {
  it('numbers the address when it is taken', () => {
    expect(slugCandidates('mara', 3)).toEqual(['mara', 'mara-2', 'mara-3']);
  });
});

describe('signupProblem', () => {
  const form = {
    businessName: 'Mara Studio',
    slug: 'mara-studio',
    email: 'mara@example.com',
    password: 'longenough',
  };

  it('passes a complete form', () => {
    expect(signupProblem(form)).toBeNull();
  });

  it('names the one thing wrong', () => {
    expect(signupProblem({ ...form, businessName: ' ' })).toMatch(/called/);
    expect(signupProblem({ ...form, slug: 'admin' })).toMatch(/kept for intro/);
    expect(signupProblem({ ...form, slug: 'a b' })).toMatch(/lowercase/);
    expect(signupProblem({ ...form, email: 'mara@' })).toMatch(/email/);
    expect(signupProblem({ ...form, password: 'short' })).toMatch(/at least 8/);
    expect(signupProblem({ ...form, password: 'é'.repeat(40) })).toMatch(/too long/);
  });
});

describe('readPendingBusiness', () => {
  it('reads what the form left on the login', () => {
    expect(
      readPendingBusiness({
        pending_business: { name: ' Mara ', slug: 'mara-studio', timezone: 'Europe/Madrid' },
      }),
    ).toEqual({ name: 'Mara', slug: 'mara-studio', timezone: 'Europe/Madrid' });
  });

  it('refuses anything missing or malformed', () => {
    expect(readPendingBusiness(null)).toBeNull();
    expect(readPendingBusiness({})).toBeNull();
    expect(
      readPendingBusiness({ pending_business: { name: 'Mara', slug: 'admin', timezone: 'UTC' } }),
    ).toBeNull();
    expect(readPendingBusiness({ pending_business: { name: '', slug: 'mara', timezone: 'UTC' } })).toBeNull();
  });
});
