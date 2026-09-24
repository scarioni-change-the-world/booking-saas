import { describe, expect, it } from 'vitest';
import { buildFlow, describeFlow, drawFlow, type FlowInput, type FlowService } from '@/lib/flow';

function service(over: Partial<FlowService>): FlowService {
  return {
    id: 's1',
    name: 'Portrait session',
    description: 'An hour in the studio.',
    durationMinutes: 60,
    priceMinor: 12000,
    locationKind: 'in_person',
    locationDetail: 'Calle Mayor 1',
    bookingMode: 'single',
    packSize: null,
    availableToProspects: true,
    availableToExistingClients: false,
    active: true,
    ownQuestionCount: 0,
    color: '#2c6a63',
    ...over,
  };
}

function input(over: Partial<FlowInput>): FlowInput {
  return {
    tenant: { slug: 'ruiz', name: 'Ruiz Photography', currency: 'EUR' },
    funnel: { started: 28, completed: 24, meeting: 11, other: 13, returning: 3 },
    globalQuestionCount: 3,
    availabilityRuleCount: 4,
    hasOtherPathMessage: true,
    hasOtherPathUrl: true,
    otherPathLabel: 'Read the pricing guide',
    services: [service({})],
    questionInsights: [],
    serviceInsights: [{ eventTypeId: 's1', started: 28, completed: 24, meeting: 11, other: 13 }],
    bookings: [],
    weeklyMinutes: 32 * 60,
    calendarStatus: 'active',
    syncFailures: 0,
    emailFailures: 0,
    clientCount: 12,
    ...over,
  };
}

describe('buildFlow', () => {
  it('makes each active service a lane with its own counts', () => {
    const model = buildFlow(
      input({
        services: [service({}), service({ id: 's2', name: 'Old thing', active: false })],
        bookings: [
          { eventTypeId: 's1', status: 'confirmed', byExistingClient: false },
          { eventTypeId: 's1', status: 'confirmed', byExistingClient: true },
          { eventTypeId: 's1', status: 'cancelled', byExistingClient: false },
        ],
      }),
    );
    expect(model.lanes).toHaveLength(1);
    expect(model.lanes[0]).toMatchObject({ qualified: 11, booked: 2, bookedByClients: 1, live: true });
    expect(model.lanes[0]!.sub).toMatch(/120.*60 min/);
    expect(model.archived).toEqual([{ id: 's2', name: 'Old thing' }]);
    expect(model.booked.total).toBe(2);
    expect(model.clients.booked).toBe(1);
  });

  it('marks a service offered to nobody as not connected, and says why on the lane', () => {
    const model = buildFlow(input({ services: [service({ availableToProspects: false })] }));
    const lane = model.lanes[0]!;
    expect(lane.live).toBe(false);
    expect(lane.sub).toBe('offered to nobody');
    expect(lane.blocking.map((s) => s.id)).toEqual(['review']);
  });

  it('keeps business-wide gaps off the lanes and on the parts they belong to', () => {
    const model = buildFlow(input({ availabilityRuleCount: 0, hasOtherPathMessage: false, hasOtherPathUrl: false }));
    expect(model.lanes[0]!.blocking).toEqual([]);
    expect(model.calendar.noHours).toBe(true);
    expect(model.elsewhere.said).toBe(false);
  });

  it('draws the price as missing rather than as free', () => {
    const model = buildFlow(input({ services: [service({ priceMinor: null })] }));
    expect(model.lanes[0]!.sub).toBe('price — · 60 min');
    expect(model.lanes[0]!.loose.map((s) => s.id)).toContain('rules');
  });

  it('raises a flag where something needs a look', () => {
    const model = buildFlow(input({ syncFailures: 2, emailFailures: 1 }));
    expect(model.calendar.flag).toBe('2 not in your calendar');
    expect(model.booked.flag).toBe('1 email did not arrive');
    expect(buildFlow(input({ calendarStatus: 'revoked' })).calendar.flag).toBe('Google Calendar needs reconnecting');
  });
});

describe('drawFlow', () => {
  it('joins a lane to both doors when it is offered to both', () => {
    const d = drawFlow(buildFlow(input({ services: [service({ availableToExistingClients: true })] })), 'ruiz');
    const ids = d.edges.map((e) => e.id);
    expect(ids).toContain('questions-s1');
    expect(ids).toContain('clients-s1');
    expect(ids).not.toContain('gap-s1');
  });

  it('draws a broken line into a lane offered to nobody, and none out of it', () => {
    const d = drawFlow(buildFlow(input({ services: [service({ availableToProspects: false })] })), 'ruiz');
    expect(d.edges.find((e) => e.id === 'gap-s1')).toMatchObject({ tone: 'gap', label: null });
    expect(d.edges.find((e) => e.id === 's1-calendar')).toMatchObject({ tone: 'gap', label: null });
    expect(d.nodes.find((n) => n.part === 'service:s1')!.tone).toBe('broken');
  });

  it('breaks every line into the calendar when there are no hours', () => {
    const d = drawFlow(buildFlow(input({ availabilityRuleCount: 0 })), 'ruiz');
    expect(d.edges.find((e) => e.id === 's1-calendar')!.tone).toBe('gap');
    expect(d.nodes.find((n) => n.part === 'calendar')!.sub).toBe('no hours');
  });

  it('stacks lanes without overlap and keeps the client door below them', () => {
    const services = [1, 2, 3, 4, 5].map((n) => service({ id: `s${n}`, name: `S${n}`, availableToExistingClients: n > 3 }));
    const d = drawFlow(buildFlow(input({ services })), 'ruiz');
    const lanes = d.nodes.filter((n) => n.part.startsWith('service:')).sort((a, b) => a.y - b.y);
    for (let i = 1; i < lanes.length; i++) expect(lanes[i]!.y).toBeGreaterThanOrEqual(lanes[i - 1]!.y + lanes[i - 1]!.h);
    const door = d.nodes.find((n) => n.part === 'clients')!;
    expect(door.y).toBeGreaterThan(lanes.at(-1)!.y + lanes.at(-1)!.h);
    expect(d.height).toBeGreaterThan(door.y + door.h);
  });

  it('shows usual weekly hours on the calendar', () => {
    const d = drawFlow(buildFlow(input({ weeklyMinutes: 90 + 32 * 60 })), 'ruiz');
    expect(d.nodes.find((n) => n.part === 'calendar')!.sub).toBe('33.5 h a week');
  });
});

describe('telling services apart', () => {
  it('gives each lane its colour and mark, and draws its lines in that colour', () => {
    const d = drawFlow(
      buildFlow(
        input({
          services: [
            service({}),
            service({ id: 's2', name: 'Wedding coverage', color: '#7a4e7e' }),
          ],
        }),
      ),
      'ruiz',
    );
    const wedding = d.nodes.find((n) => n.part === 'service:s2')!;
    expect(wedding).toMatchObject({ color: '#7a4e7e', monogram: 'WC' });
    expect(d.edges.find((e) => e.id === 'questions-s2')!.color).toBe('#7a4e7e');
    expect(d.edges.find((e) => e.id === 's2-calendar')!.color).toBe('#7a4e7e');
    expect(d.nodes.find((n) => n.part === 'questions')!.color).toBeUndefined();
  });
});

describe('describeFlow', () => {
  it('says the whole flow in one paragraph, for a screen reader', () => {
    const text = describeFlow(buildFlow(input({})));
    expect(text).toContain('28 new people reached your page');
    expect(text).toContain('Portrait session: 11 let through, 0 booked');
  });
});
