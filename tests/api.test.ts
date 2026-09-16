import { describe, expect, it } from 'vitest';
import { optionalNullableUrl } from '@/lib/api';

describe('optionalNullableUrl', () => {
  it('is undefined when the key is absent — leave unchanged', () => {
    expect(optionalNullableUrl({}, 'redirectUrl')).toBeUndefined();
  });

  it('is null when explicitly cleared with null or an empty string', () => {
    expect(optionalNullableUrl({ redirectUrl: null }, 'redirectUrl')).toBeNull();
    expect(optionalNullableUrl({ redirectUrl: '' }, 'redirectUrl')).toBeNull();
  });

  it('accepts a plain http/https URL', () => {
    expect(optionalNullableUrl({ redirectUrl: 'https://example.com/guide' }, 'redirectUrl')).toBe(
      'https://example.com/guide',
    );
    expect(optionalNullableUrl({ redirectUrl: 'http://example.com' }, 'redirectUrl')).toBe(
      'http://example.com',
    );
  });

  // The whole reason this function exists rather than optionalNullableString:
  // this value is rendered as an href in a *prospect's* browser (brief 2.2),
  // on a page that skips the qualification gate that would otherwise stand
  // between a tenant and that visitor.
  it('rejects a javascript: URL — the actual XSS vector this guards against', () => {
    expect(() =>
      optionalNullableUrl({ redirectUrl: 'javascript:alert(document.cookie)' }, 'redirectUrl'),
    ).toThrow(/http/);
  });

  it('rejects other non-http(s) schemes', () => {
    expect(() => optionalNullableUrl({ redirectUrl: 'data:text/html,x' }, 'redirectUrl')).toThrow();
    expect(() => optionalNullableUrl({ redirectUrl: 'vbscript:msgbox(1)' }, 'redirectUrl')).toThrow();
    expect(() => optionalNullableUrl({ redirectUrl: 'file:///etc/passwd' }, 'redirectUrl')).toThrow();
  });

  it('rejects a value that is not a URL at all', () => {
    expect(() => optionalNullableUrl({ redirectUrl: 'not a url' }, 'redirectUrl')).toThrow();
  });
});
