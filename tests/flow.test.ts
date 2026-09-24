import { describe, expect, it } from 'vitest';
import {
  asksQuestions,
  bookedByNew,
  buildFlow,
  describeLane,
  drawServiceFlow,
  type FlowInput,
  type FlowService,
} from '@/lib/flow';

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
    questionInsightsByService: {},
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

const edge = (d: ReturnType<typeof drawServiceFlow>, id: string) => d.edges.find((e) => e.id === id)!;
const node = (d: ReturnType<typeof drawServiceFlow>, part: string) => d.nodes.find((n) => n.part === part)!;

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
    expect(model.lanes[0]).toMatchObject({
      started: 28,
      finished: 24,
      qualified: 11,
      sentElsewhere: 13,
      booked: 2,
      bookedByClients: 1,
      live: true,
    });
    expect(bookedByNew(model.lanes[0]!)).toBe(1);
    expect(model.archived).toEqual([{ id: 's2', name: 'Old thing' }]);
  });

  it('counts a service’s questions as the shared ones plus its own', () => {
    const lane = buildFlow(input({ services: [service({ ownQuestionCount: 2 })] })).lanes[0]!;
    expect([lane.sharedQuestions, lane.ownQuestions]).toEqual([3, 2]);
    expect(asksQuestions(lane)).toBe(true);
    const bare = buildFlow(input({ globalQuestionCount: 0 })).lanes[0]!;
    expect(asksQuestions(bare)).toBe(false);
  });

  it('keeps each service’s question findings to itself', () => {
    const insight = { questionId: 'q', prompt: 'Budget?', answered: 5, sentElsewhere: 2, routingAnswers: [] };
    const model = buildFlow(
      input({
        services: [service({}), service({ id: 's2', name: 'Wedding' })],
        questionInsightsByService: { s2: [insight] },
      }),
    );
    expect(model.lanes[0]!.questionInsights).toEqual([]);
    expect(model.lanes[1]!.questionInsights).toEqual([insight]);
  });

  it('marks a service offered to nobody as not connected, and says why on it', () => {
    const lane = buildFlow(input({ services: [service({ availableToProspects: false })] })).lanes[0]!;
    expect(lane.live).toBe(false);
    expect(lane.sub).toBe('offered to nobody');
  });

  it('draws the price as missing rather than as free', () => {
    const lane = buildFlow(input({ services: [service({ priceMinor: null })] })).lanes[0]!;
    expect(lane.sub).toBe('price — · 60 min');
  });

  it('raises a flag where something needs a look', () => {
    const model = buildFlow(input({ syncFailures: 2, emailFailures: 1 }));
    expect(model.calendar.flag).toBe('2 not in your calendar');
    expect(model.booked.flag).toBe('1 email did not arrive');
  });
});

describe('drawServiceFlow', () => {
  const draw = (over: Partial<FlowInput>, svc: Partial<FlowService> = {}) => {
    const model = buildFlow(input({ services: [service(svc)], ...over }));
    return drawServiceFlow(model, model.lanes[0]!, 'ruiz');
  };

  it('runs in the booking page’s order: page, service, questions, calendar, booked', () => {
    const d = draw({});
    const xs = ['page', 'service:s1', 'questions', 'calendar', 'booked'].map((p) => node(d, p).x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(node(d, 'elsewhere').y).toBeLessThan(node(d, 'questions').y);
  });

  it('puts this service’s own numbers on its lines, in its colour', () => {
    const d = draw({
      bookings: [
        { eventTypeId: 's1', status: 'confirmed', byExistingClient: false },
        { eventTypeId: 's1', status: 'confirmed', byExistingClient: true },
      ],
    }, { availableToExistingClients: true });
    expect(edge(d, 'page-service')).toMatchObject({ label: '28', color: '#2c6a63' });
    expect(edge(d, 'questions-elsewhere').label).toBe('13');
    expect(edge(d, 'questions-calendar').label).toBe('11');
    expect(edge(d, 'calendar-booked').label).toBe('2');
    expect(edge(d, 'clients-service').label).toBe('1');
    expect(edge(d, 'service-calendar-direct')).toMatchObject({ tone: 'on', label: 'skips the questions' });
  });

  it('breaks the way in that a service is not offered through', () => {
    const d = draw({}, { availableToExistingClients: false });
    expect(edge(d, 'clients-service').tone).toBe('gap');
    expect(edge(d, 'service-calendar-direct')).toMatchObject({ tone: 'gap', label: 'not offered to existing clients' });
    const nobody = draw({}, { availableToProspects: false });
    expect(edge(nobody, 'page-service').tone).toBe('gap');
    expect(node(nobody, 'service:s1').tone).toBe('broken');
  });

  it('breaks every line into the calendar when there are no hours', () => {
    const d = draw({ availabilityRuleCount: 0 });
    expect(edge(d, 'questions-calendar').tone).toBe('gap');
    expect(edge(d, 'calendar-booked').tone).toBe('gap');
    expect(node(d, 'calendar').sub).toBe('no hours');
  });

  it('says so when a service asks nothing, and counts people straight through', () => {
    const d = draw(
      { globalQuestionCount: 0, bookings: [{ eventTypeId: 's1', status: 'confirmed', byExistingClient: false }] },
    );
    expect(node(d, 'questions').sub).toBe('nothing asked');
    expect(edge(d, 'questions-elsewhere').tone).toBe('gap');
    expect(edge(d, 'page-service').label).toBe('1');
  });
});

describe('describeLane', () => {
  it('says the service’s flow in words, for a screen reader', () => {
    const model = buildFlow(input({}));
    const text = describeLane(model, model.lanes[0]!);
    expect(text).toContain('Portrait session, the last 30 days');
    expect(text).toContain('28 new people chose it and started its questions');
    expect(text).toContain('11 were let through');
  });
});
