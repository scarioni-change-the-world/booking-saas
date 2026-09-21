import { describe, expect, it } from 'vitest';
import { buildIcsCalendar } from '@/lib/ics';

/**
 * The pack rules that can be checked without a database.
 *
 * createBookingPack's own guarantee — ten appointments or none — is
 * Postgres's, not TypeScript's: it comes from migration 0004's exclusion
 * constraint being evaluated across a single multi-row INSERT. That cannot
 * be asserted here, so what is asserted is everything around it, and the
 * comment in createBookingPack records why the shape of the call matters.
 */

const event = (startsAt: string, uid: string) => ({
  uid,
  summary: 'Career coaching — Amelia Rivera',
  startsAt,
  endsAt: new Date(new Date(startsAt).getTime() + 50 * 60_000).toISOString(),
});

describe('buildIcsCalendar', () => {
  it('puts every appointment in one file', () => {
    const ics = buildIcsCalendar([
      event('2026-10-06T09:00:00.000Z', 'a'),
      event('2026-10-09T13:30:00.000Z', 'b'),
      event('2026-10-13T09:00:00.000Z', 'c'),
    ]);

    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(ics.match(/END:VCALENDAR/g)).toHaveLength(1);
  });

  /* They stay independent appointments: cancelling session three must update
     session three's calendar entry and nothing else, which is what a
     distinct UID per event is for. */
  it('gives each appointment its own identity', () => {
    const ics = buildIcsCalendar([
      event('2026-10-06T09:00:00.000Z', 'first'),
      event('2026-10-09T13:30:00.000Z', 'second'),
    ]);

    expect(ics).toContain('UID:first@intro');
    expect(ics).toContain('UID:second@intro');
  });

  it('keeps the CRLF line endings RFC 5545 requires', () => {
    const ics = buildIcsCalendar([event('2026-10-06T09:00:00.000Z', 'a')]);
    expect(ics.split('\n').every((line) => line === '' || line.endsWith('\r'))).toBe(true);
  });

  /* One event through the multi-event builder has to be byte-identical to
     what buildIcs produced before, because that is now what buildIcs is. */
  it('is unchanged for a single appointment', async () => {
    const { buildIcs } = await import('@/lib/ics');
    const one = event('2026-10-06T09:00:00.000Z', 'only');
    expect(buildIcs(one)).toBe(buildIcsCalendar([one]));
  });

  it('has a valid, empty calendar for no appointments rather than broken output', () => {
    const ics = buildIcsCalendar([]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});
