import { describe, expect, it } from 'vitest';
import { normaliseWebsite, websiteLabel } from '@/lib/website';

describe('normaliseWebsite', () => {
  it('adds https:// to a bare domain and drops a lone trailing slash', () => {
    expect(normaliseWebsite('mara.studio')).toEqual({ ok: true, url: 'https://mara.studio' });
    expect(normaliseWebsite(' https://www.mara.studio/ ')).toEqual({ ok: true, url: 'https://www.mara.studio' });
  });

  it('keeps a path', () => {
    expect(normaliseWebsite('www.mara.studio/coaching')).toEqual({
      ok: true,
      url: 'https://www.mara.studio/coaching',
    });
  });

  it('treats empty as "no website"', () => {
    expect(normaliseWebsite('  ')).toEqual({ ok: true, url: null });
    expect(normaliseWebsite(null)).toEqual({ ok: true, url: null });
  });

  it('refuses anything that is not a plain web address', () => {
    expect(normaliseWebsite('javascript:alert(1)').ok).toBe(false);
    expect(normaliseWebsite('mailto:a@b.com').ok).toBe(false);
    expect(normaliseWebsite('localhost').ok).toBe(false);
    expect(normaliseWebsite('https://user:pw@mara.studio').ok).toBe(false);
    expect(normaliseWebsite(42).ok).toBe(false);
    expect(normaliseWebsite('a'.repeat(201) + '.com').ok).toBe(false);
  });
});

describe('websiteLabel', () => {
  it('reads as the bare domain', () => {
    expect(websiteLabel('https://www.mara.studio/coaching')).toBe('mara.studio');
  });
});
