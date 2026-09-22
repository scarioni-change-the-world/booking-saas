import { describe, expect, it } from 'vitest';
import { serviceIdOf } from '@/components/ClientBooking';

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
