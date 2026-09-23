import { describe, expect, it } from 'vitest';
import { pickRule, serviceIdOf } from '@/components/ClientBooking';

/**
 * The union that broke package redemption.
 *
 * Both kinds of option carry an `id`, and they name different things. Every
 * redemption asked the availability endpoint for the entitlement's id as
 * though it were a service's, got "Unknown event type" back, and rendered
 * "No times are available in the next few weeks" — which reads as an empty
 * diary rather than as a bug, so it survived a manual test of the pack
 * flow.
 */
describe('serviceIdOf', () => {
  const entitlement = {
    kind: 'package' as const,
    id: 'entitlement-1',
    eventTypeId: 'event-type-1',
    eventTypeName: 'Career coaching',
    durationMinutes: 50,
    totalSessions: 3,
    usedSessions: 2,
    remaining: 1,
  };

  const single = {
    kind: 'single' as const,
    id: 'event-type-2',
    name: 'Discovery call',
    durationMinutes: 30,
  };

  it('asks for the service a package redeems against, not the grant', () => {
    expect(serviceIdOf(entitlement)).toBe('event-type-1');
  });

  it('never returns the entitlement id, which is what the bug did', () => {
    expect(serviceIdOf(entitlement)).not.toBe(entitlement.id);
  });

  it('asks for the service itself for a one-off booking', () => {
    expect(serviceIdOf(single)).toBe('event-type-2');
  });
});

describe('pickRule', () => {
  const held = {
    kind: 'package' as const,
    id: 'ent-1',
    eventTypeId: 'evt-1',
    eventTypeName: 'Career coaching',
    durationMinutes: 50,
    totalSessions: 10,
    usedSessions: 7,
    remaining: 3,
  };

  const forSale = {
    kind: 'programme' as const,
    id: 'evt-1',
    name: 'Career coaching',
    durationMinutes: 50,
    packSize: 10,
    priceMinor: 7000,
  };

  const single = {
    kind: 'single' as const,
    id: 'evt-2',
    name: 'Discovery call',
    durationMinutes: 30,
  };

  it('lets a held package be spent at any pace, up to the balance', () => {
    expect(pickRule(held)).toEqual({ cap: 3, exact: false });
  });

  it('sells a programme whole — a pack is all of its appointments or none', () => {
    expect(pickRule(forSale)).toEqual({ cap: 10, exact: true });
  });

  it('caps a one-off at one', () => {
    expect(pickRule(single)).toEqual({ cap: 1, exact: true });
  });

  it('asks the right service for availability when buying, not the grant', () => {
    /* The bug that made redemption silently impossible was reading `id`
       off a union whose members mean different things by it. A programme
       for sale IS an event type, so its id is already the right one — this
       pins that, so the next member added to the union has to think. */
    expect(serviceIdOf(forSale)).toBe('evt-1');
  });
});
