import { describe, expect, it } from 'vitest';
import { mapUrl, mapUrlForInvite, preferredMapService } from '@/lib/maps';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

describe('preferredMapService', () => {
  it('sends Apple devices to Apple Maps', () => {
    expect(preferredMapService(IPHONE)).toBe('apple');
    expect(preferredMapService(MAC)).toBe('apple');
  });

  it('sends everything else to Google', () => {
    expect(preferredMapService(ANDROID)).toBe('google');
    expect(preferredMapService(WINDOWS)).toBe('google');
  });

  /* A user-agent sniff is unreliable by nature, so the unknown case has to
     land on the service that works everywhere rather than the one that
     does not. */
  it('sends an unrecognised device to the one that works anywhere', () => {
    expect(preferredMapService('')).toBe('google');
    expect(preferredMapService('something nobody has seen')).toBe('google');
  });
});

describe('mapUrl', () => {
  it('builds a Google search link', () => {
    expect(mapUrl('Calle Mayor 4, Madrid')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Calle%20Mayor%204%2C%20Madrid',
    );
  });

  it('builds an Apple search link', () => {
    expect(mapUrl('Calle Mayor 4, Madrid', 'apple')).toBe(
      'https://maps.apple.com/?q=Calle%20Mayor%204%2C%20Madrid',
    );
  });

  /* The address is tenant-written free text and goes straight into a URL.
     Encoding it is what stops an address with an ampersand in it becoming
     two query parameters — or worse. */
  it('encodes everything that would otherwise change the URL', () => {
    const url = mapUrl('A & B Clinic, 2º #3?x=1', 'google')!;
    expect(url).not.toMatch(/[ #]/);
    expect(url.split('query=')[1]).not.toContain('&');
    expect(decodeURIComponent(url.split('query=')[1]!)).toBe('A & B Clinic, 2º #3?x=1');
  });

  it('has no link for an address that is not one', () => {
    expect(mapUrl('')).toBeNull();
    expect(mapUrl('   ')).toBeNull();
  });

  /* An invitation is written once on a server and read on whatever device
     the client opens it with — often more than one. */
  it('always uses the universal service for an invitation', () => {
    expect(mapUrlForInvite('Calle Mayor 4')).toContain('google.com');
  });
});
