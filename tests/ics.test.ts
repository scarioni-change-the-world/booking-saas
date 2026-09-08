import { describe, expect, it } from 'vitest';
import { buildIcs } from '@/lib/ics';

function lines(ics: string): string[] {
  return ics.split('\r\n').filter((l) => l !== '');
}

describe('buildIcs', () => {
  it('produces a complete, well-formed VCALENDAR/VEVENT', () => {
    const ics = buildIcs({
      uid: 'booking-1',
      summary: 'Discovery call',
      startsAt: '2027-01-15T09:00:00.000Z',
      endsAt: '2027-01-15T09:30:00.000Z',
    });

    const ls = lines(ics);
    expect(ls[0]).toBe('BEGIN:VCALENDAR');
    expect(ls).toContain('BEGIN:VEVENT');
    expect(ls).toContain('DTSTART:20270115T090000Z');
    expect(ls).toContain('DTEND:20270115T093000Z');
    expect(ls).toContain('SUMMARY:Discovery call');
    expect(ls).toContain('UID:booking-1@intro');
    expect(ls).toContain('END:VEVENT');
    expect(ls[ls.length - 1]).toBe('END:VCALENDAR');
  });

  it('uses CRLF line endings throughout, per RFC 5545', () => {
    const ics = buildIcs({
      uid: 'b1',
      summary: 'X',
      startsAt: '2027-01-15T09:00:00.000Z',
      endsAt: '2027-01-15T09:30:00.000Z',
    });
    expect(ics.includes('\r\n')).toBe(true);
    // No bare \n that isn't part of a \r\n pair.
    expect(ics.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  it('omits optional fields when not given', () => {
    const ics = buildIcs({
      uid: 'b1',
      summary: 'X',
      startsAt: '2027-01-15T09:00:00.000Z',
      endsAt: '2027-01-15T09:30:00.000Z',
    });
    expect(ics).not.toContain('DESCRIPTION:');
    expect(ics).not.toContain('LOCATION:');
    expect(ics).not.toContain('ORGANIZER');
    expect(ics).not.toContain('ATTENDEE');
  });

  it('includes organizer and attendee when given', () => {
    const ics = buildIcs({
      uid: 'b1',
      summary: 'X',
      startsAt: '2027-01-15T09:00:00.000Z',
      endsAt: '2027-01-15T09:30:00.000Z',
      organizer: { name: 'Demo Coaching', email: 'owner@example.com' },
      attendee: { name: 'Ana Test', email: 'ana@example.com' },
    });
    expect(ics).toContain('ORGANIZER;CN=Demo Coaching:mailto:owner@example.com');
    expect(ics).toContain('ATTENDEE;CN=Ana Test;ROLE=REQ-PARTICIPANT:mailto:ana@example.com');
  });

  it('escapes commas, semicolons, backslashes and newlines in text fields', () => {
    const ics = buildIcs({
      uid: 'b1',
      summary: 'A; tricky, summary \\ with stuff',
      description: 'Line one\nLine two',
      startsAt: '2027-01-15T09:00:00.000Z',
      endsAt: '2027-01-15T09:30:00.000Z',
    });
    expect(ics).toContain('SUMMARY:A\\; tricky\\, summary \\\\ with stuff');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
  });

  it('folds a line longer than 75 octets, with a leading space on the continuation', () => {
    const longSummary = 'S'.repeat(100);
    const ics = buildIcs({
      uid: 'b1',
      summary: longSummary,
      startsAt: '2027-01-15T09:00:00.000Z',
      endsAt: '2027-01-15T09:30:00.000Z',
    });
    const raw = ics.split('\r\n');
    const summaryLineIndex = raw.findIndex((l) => l.startsWith('SUMMARY:'));
    // The continuation line starts with a single leading space.
    expect(raw[summaryLineIndex + 1]?.startsWith(' ')).toBe(true);
    // Rejoining the fold (dropping CRLF + the single leading space) recovers
    // the original content exactly.
    const rejoined = raw[summaryLineIndex] + raw[summaryLineIndex + 1]!.slice(1);
    expect(rejoined).toBe(`SUMMARY:${longSummary}`);
  });

  it('never splits a multi-byte UTF-8 character across a fold', () => {
    // 40 emoji, each 4 bytes in UTF-8 — comfortably over the fold threshold.
    const summary = '😀'.repeat(40);
    const ics = buildIcs({
      uid: 'b1',
      summary,
      startsAt: '2027-01-15T09:00:00.000Z',
      endsAt: '2027-01-15T09:30:00.000Z',
    });
    // A corrupted split would produce a replacement character or unpaired
    // surrogate; string round-trips through valid UTF-16 either way here,
    // so the real check is that every codepoint from the input survives.
    const raw = ics.split('\r\n').filter((l) => l !== '');
    const summaryLines: string[] = [];
    let collecting = false;
    for (const line of raw) {
      if (line.startsWith('SUMMARY:')) collecting = true;
      else if (collecting && !line.startsWith(' ')) break;
      if (collecting) summaryLines.push(line);
    }
    const rejoined = summaryLines
      .map((l, i) => (i === 0 ? l.slice('SUMMARY:'.length) : l.slice(1)))
      .join('');
    expect(rejoined).toBe(summary);
  });
});
