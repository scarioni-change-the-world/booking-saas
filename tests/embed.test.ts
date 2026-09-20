import { describe, expect, it } from 'vitest';
import {
  MAX_EMBED_DOMAINS,
  embedSnippet,
  frameAncestors,
  normaliseEmbedDomain,
  normaliseEmbedDomains,
} from '@/lib/embed';

/**
 * These values are joined into a Content-Security-Policy header. A stored
 * space or semicolon would not be a malformed hostname — it would be a
 * second CSP directive written by us and served to every visitor of that
 * tenant's page. Most of what follows is that one concern.
 */
describe('normaliseEmbedDomain', () => {
  it('accepts a plain hostname', () => {
    expect(normaliseEmbedDomain('example.com')).toBe('example.com');
    expect(normaliseEmbedDomain('www.example.co.uk')).toBe('www.example.co.uk');
  });

  it('accepts a subdomain wildcard', () => {
    expect(normaliseEmbedDomain('*.example.com')).toBe('*.example.com');
  });

  it('accepts a port, which CSP allows', () => {
    expect(normaliseEmbedDomain('example.com:8443')).toBe('example.com:8443');
  });

  // People paste out of an address bar. Being forgiving here is not laxity:
  // the value is still normalised down to a host before anything stores it.
  it('takes the host out of a pasted URL', () => {
    expect(normaliseEmbedDomain('https://www.example.com/book?ref=1')).toBe('www.example.com');
    expect(normaliseEmbedDomain('  HTTP://Example.COM/  ')).toBe('example.com');
  });

  it('drops a trailing dot, which is a valid host but not valid in CSP', () => {
    expect(normaliseEmbedDomain('example.com.')).toBe('example.com');
  });

  describe('refuses anything that could become a second CSP directive', () => {
    for (const evil of [
      'example.com; script-src *',
      "example.com 'unsafe-inline'",
      'example.com *',
      'exa mple.com',
      "example.com'",
      'example.com"',
      'example.com\nscript-src *',
      'example.com\u0000',
      'exam;ple.com',
    ]) {
      it(JSON.stringify(evil), () => {
        expect(normaliseEmbedDomain(evil)).toBeNull();
      });
    }
  });

  // A bare wildcard would let any site on earth frame this tenant's booking
  // page, which is the single outcome the whole mechanism exists to prevent.
  it('refuses a bare wildcard', () => {
    expect(normaliseEmbedDomain('*')).toBeNull();
    expect(normaliseEmbedDomain('*.*')).toBeNull();
    expect(normaliseEmbedDomain('*.*.com')).toBeNull();
  });

  it('refuses a single label, which cannot be a real site', () => {
    expect(normaliseEmbedDomain('localhost')).toBeNull();
    expect(normaliseEmbedDomain('com')).toBeNull();
  });

  it('refuses a scheme it cannot express', () => {
    expect(normaliseEmbedDomain('javascript:alert(1)')).toBeNull();
    expect(normaliseEmbedDomain('data:text/html,x')).toBeNull();
  });
});

describe('normaliseEmbedDomains', () => {
  it('de-duplicates and keeps the order typed', () => {
    const { domains } = normaliseEmbedDomains(['b.com', 'a.com', 'B.com', '  ']);
    expect(domains).toEqual(['b.com', 'a.com']);
  });

  // A domain that quietly failed to save looks exactly like one that saved
  // and does not work. The interface has to be able to say which line.
  it('reports what it could not use rather than swallowing it', () => {
    const { domains, rejected } = normaliseEmbedDomains(['good.com', 'not a host']);
    expect(domains).toEqual(['good.com']);
    expect(rejected).toEqual(['not a host']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_EMBED_DOMAINS + 5 }, (_, i) => `site${i}.com`);
    expect(normaliseEmbedDomains(many).domains).toHaveLength(MAX_EMBED_DOMAINS);
  });
});

describe('frameAncestors', () => {
  // The safe default and the honest one: a tenant who has not said who may
  // embed their page has said nobody may.
  it("is 'none' when nothing is allowed", () => {
    expect(frameAncestors([])).toBe("'none'");
  });

  it('pins https, so a stored host can never be framed over http', () => {
    expect(frameAncestors(['example.com', '*.acme.io'])).toBe(
      'https://example.com https://*.acme.io',
    );
  });
});

describe('embedSnippet', () => {
  it('carries the tenant slug and both halves of the embed', () => {
    const snippet = embedSnippet('https://app.example.com', 'acme');
    expect(snippet).toContain('https://app.example.com/t/acme');
    expect(snippet).toContain('https://app.example.com/embed.js');
    expect(snippet).toContain('<iframe');
  });
});
