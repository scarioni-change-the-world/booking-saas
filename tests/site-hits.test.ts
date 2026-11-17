import { describe, expect, it } from 'vitest';
import { deviceOf, notCounted, readHit, siteSummary, sourceOf, visitorCode, type SiteRow } from '../src/lib/site-hits';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
const ctx = { userAgent: MAC, country: 'ES', ownHosts: ['khloe.io'] };

describe('site counter', () => {
  it('does not count browsers that ask not to be tracked, or robots', () => {
    expect(notCounted(new Headers({ 'user-agent': MAC, 'sec-gpc': '1' }))).toBe(true);
    expect(notCounted(new Headers({ 'user-agent': MAC, dnt: '1' }))).toBe(true);
    expect(notCounted(new Headers({ 'user-agent': 'Googlebot/2.1' }))).toBe(true);
    expect(notCounted(new Headers({}))).toBe(true);
    expect(notCounted(new Headers({ 'user-agent': MAC }))).toBe(false);
  });

  it('keeps the page without its query, and where the visitor came from as a host only', () => {
    const hit = readHit({ kind: 'pageview', path: '/?email=ana@example.com#x', referrer: 'https://www.instagram.com/p/123?u=ana' }, ctx);
    expect(hit).toEqual({ kind: 'pageview', path: '/', source: 'instagram.com', place: null, device: 'computer', country: 'ES' });
    expect(sourceOf('https://khloe.io/pricing', ['khloe.io'])).toBeNull();
    expect(sourceOf('not a url', ['khloe.io'])).toBeNull();
  });

  it('refuses anything it does not know', () => {
    expect(readHit({ kind: 'Click', path: '/' }, ctx)).toBeNull();
    expect(readHit({ kind: 'pageview', path: 'https://evil.example' }, ctx)).toBeNull();
    expect(readHit('nope', ctx)).toBeNull();
    expect(readHit({ kind: 'Start free', path: '/', place: '<script>' }, ctx)?.place).toBeNull();
    expect(readHit({ kind: 'Start free', path: '/', place: 'hero' }, ctx)?.place).toBe('hero');
  });

  it('tells phones, tablets and computers apart', () => {
    expect(deviceOf(IPHONE)).toBe('phone');
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet');
    expect(deviceOf(MAC)).toBe('computer');
  });

  it('makes a visitor code that holds all day and changes the next', () => {
    const a = visitorCode('secret', '2026-11-17', '203.0.113.9', MAC);
    expect(a).toHaveLength(16);
    expect(visitorCode('secret', '2026-11-17', '203.0.113.9', MAC)).toBe(a);
    expect(visitorCode('secret', '2026-11-18', '203.0.113.9', MAC)).not.toBe(a);
    expect(a).not.toContain('203');
  });

  it('sums visits for the console', () => {
    const row = (over: Partial<SiteRow>): SiteRow => ({ day: '2026-11-17', kind: 'pageview', source: null, place: null, device: 'phone', visitor: 'v1', ...over });
    const s = siteSummary(
      [
        row({}),
        row({}),
        row({ visitor: 'v2', source: 'instagram.com', device: 'computer' }),
        row({ day: '2026-11-18' }),
        row({ kind: 'Start free', place: 'hero' }),
        row({ kind: 'Demo started' }),
      ],
      [row({ visitor: 'old' })],
    );
    expect(s.visitors).toEqual({ now: 3, before: 1 });
    expect(s.pageviews).toBe(4);
    expect(s.startFree.now).toBe(1);
    expect(s.startFreeRate).toBe(33.3);
    expect(s.sources[0]).toEqual({ host: 'Direct', n: 3 });
    expect(s.devices).toEqual({ phone: 3, tablet: 0, computer: 1 });
  });
});
