import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { zoneCity, zoneNote } from '@/components/booking/zone-note';

const winter = DateTime.fromISO('2026-11-16T10:00:00Z');

describe('zoneNote', () => {
  it('names the city, not the zone id', () => {
    expect(zoneCity('America/New_York')).toBe('New York');
    expect(zoneNote('Europe/Berlin', 'Europe/Berlin', 'Gulnara', winter)).toBe('Times are in your time zone (Berlin).');
  });

  it('says when the clocks match although the zones differ', () => {
    expect(zoneNote('Europe/Madrid', 'Europe/Berlin', 'Gulnara', winter)).toBe(
      'Times are in your time zone (Madrid), the same as Gulnara in Berlin.',
    );
  });

  it('says how far apart the clocks are', () => {
    expect(zoneNote('Europe/London', 'Europe/Berlin', 'Gulnara', winter)).toBe(
      'Times are in your time zone (London): 1 hour behind Gulnara in Berlin.',
    );
    expect(zoneNote('Asia/Dubai', 'Europe/Berlin', 'Gulnara', winter)).toBe(
      'Times are in your time zone (Dubai): 3 hours ahead of Gulnara in Berlin.',
    );
  });
});
