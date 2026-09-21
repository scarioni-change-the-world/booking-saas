import { describe, expect, it } from 'vitest';
import { parseLocation } from '@/lib/admin-event-types';
import { LOCATION_LABELS, LOCATION_OPTIONS, describeLocation } from '@/lib/service-location';

describe('describeLocation', () => {
  it('says the kind on its own when there is no detail', () => {
    expect(describeLocation('online', null)).toBe('Online');
    expect(describeLocation('phone', null)).toBe('By phone');
  });

  it('joins the kind and the detail', () => {
    expect(describeLocation('in_person', 'Calle Mayor 4')).toBe('In person · Calle Mayor 4');
  });

  /* Nothing at all, rather than an empty line — a service with no stated
     location simply does not mention one. */
  it('has nothing to say without a kind', () => {
    expect(describeLocation(null, null)).toBeNull();
    expect(describeLocation(null, 'Calle Mayor 4')).toBeNull();
  });

  it("never shows a client the database's word for it", () => {
    expect(Object.values(LOCATION_LABELS)).not.toContain('in_person');
    for (const option of LOCATION_OPTIONS) {
      expect(option.label).not.toMatch(/_/);
    }
  });
});

describe('parseLocation', () => {
  it('leaves the field alone when neither half was sent', () => {
    expect(parseLocation({})).toBeUndefined();
    expect(parseLocation({ name: 'Something else' })).toBeUndefined();
  });

  it('reads a kind and its detail together', () => {
    expect(parseLocation({ locationKind: 'in_person', locationDetail: 'Calle Mayor 4' })).toEqual({
      locationKind: 'in_person',
      locationDetail: 'Calle Mayor 4',
    });
  });

  it('accepts a kind with no detail', () => {
    expect(parseLocation({ locationKind: 'online' })).toEqual({
      locationKind: 'online',
      locationDetail: null,
    });
  });

  /* An address that outlives the thing it described is how a business ends
     up publishing a street address under the word "Online". */
  it('clears the detail when the kind is cleared', () => {
    expect(parseLocation({ locationKind: null, locationDetail: 'Calle Mayor 4' })).toEqual({
      locationKind: null,
      locationDetail: null,
    });
    expect(parseLocation({ locationKind: '', locationDetail: 'Calle Mayor 4' })).toEqual({
      locationKind: null,
      locationDetail: null,
    });
  });

  /* Sending a detail alone would attach it to whatever kind happened to be
     stored, which the caller never saw. */
  it('refuses a detail with no kind beside it', () => {
    expect(() => parseLocation({ locationDetail: 'Calle Mayor 4' })).toThrow();
  });

  it('refuses a kind it does not know', () => {
    expect(() => parseLocation({ locationKind: 'teleport' })).toThrow();
    expect(() => parseLocation({ locationKind: 42 })).toThrow();
  });

  it('refuses a detail that is not text', () => {
    expect(() => parseLocation({ locationKind: 'online', locationDetail: 42 })).toThrow();
  });

  it('refuses a detail longer than the column holds', () => {
    expect(() =>
      parseLocation({ locationKind: 'in_person', locationDetail: 'x'.repeat(301) }),
    ).toThrow();
  });

  it('treats whitespace as nothing said', () => {
    expect(parseLocation({ locationKind: 'online', locationDetail: '   ' })).toEqual({
      locationKind: 'online',
      locationDetail: null,
    });
  });

  it('trims what it stores', () => {
    expect(
      parseLocation({ locationKind: 'in_person', locationDetail: '  Calle Mayor 4  ' }),
    ).toEqual({ locationKind: 'in_person', locationDetail: 'Calle Mayor 4' });
  });
});
