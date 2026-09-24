import { describe, expect, it } from 'vitest';
import { exactPattern } from '@/lib/like';

/** What Postgres's ILIKE does with a pattern, enough to prove the escaping. */
function ilike(value: string, pattern: string): boolean {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\') {
      re += (pattern[++i] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (c === '_') re += '.';
    else if (c === '%') re += '.*';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i').test(value);
}

describe('exactPattern', () => {
  it('still matches the same address in any case', () => {
    expect(ilike('Maya@Example.com', exactPattern('maya@example.com'))).toBe(true);
  });

  it('does not let an underscore stand for another character', () => {
    expect(ilike('axb@x.com', 'a_b@x.com')).toBe(true); // the bug, unescaped
    expect(ilike('axb@x.com', exactPattern('a_b@x.com'))).toBe(false);
    expect(ilike('a_b@x.com', exactPattern('a_b@x.com'))).toBe(true);
  });

  it('does not let a percent sign stand for anything', () => {
    expect(ilike('anyone@x.com', exactPattern('%@x.com'))).toBe(false);
  });
});
