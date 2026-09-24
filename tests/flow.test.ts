import { describe, expect, it } from 'vitest';
import {
  asksQuestions,
  buildFlow,
  laneState,
  readout,
  serviceSteps,
  stepForPart,
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

type Booking = FlowInput['bookings'][number];
const booking = (person: string, over: Partial<Booking> = {}): Booking => ({
  eventTypeId: 's1',
  status: 'confirmed',
  byExistingClient: false,
  person,
  ...over,
});

describe('buildFlow', () => {
  it('makes each active service a lane with its own counts', () => {
    const model = buildFlow(
      input({
        services: [service({}), service({ id: 's2', name: 'Old thing', active: false })],
        bookings: [
          booking('ana@x.com'),
          booking('bo@x.com', { byExistingClient: true }),
          booking('cy@x.com', { status: 'cancelled' }),
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
      bookedPeople: 2,
      bookedPeopleNew: 1,
      live: true,
    });
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

describe('counting people apart from appointments', () => {
  it('counts a programme once per person, however many sessions it holds', () => {
    const lane = buildFlow(
      input({
        services: [service({ bookingMode: 'pack', packSize: 3, durationMinutes: 30 })],
        bookings: [booking('ana@x.com'), booking('ana@x.com'), booking('ana@x.com'), booking('bo@x.com')],
      }),
    ).lanes[0]!;
    expect([lane.booked, lane.bookedPeople]).toEqual([4, 2]);
    expect(lane.words).toBe('A programme of 3 sessions, 30 minutes each · €120.00');
  });
});

describe('laneState', () => {
  it('says in words whether people can book the service now', () => {
    const live = buildFlow(input({}));
    expect(laneState(live, live.lanes[0]!)).toEqual({ label: 'Taking bookings', live: true });
    const nobody = buildFlow(input({ services: [service({ availableToProspects: false })] }));
    expect(laneState(nobody, nobody.lanes[0]!).label).toBe('Not offered yet');
    const noHours = buildFlow(input({ availabilityRuleCount: 0 }));
    expect(laneState(noHours, noHours.lanes[0]!).label).toBe('Not bookable yet');
  });
});

describe('readout', () => {
  it('says the last 30 days in one sentence, in people', () => {
    const model = buildFlow(input({ bookings: [booking('ana@x.com'), booking('bo@x.com')] }));
    expect(readout(model, model.lanes[0]!).text).toBe(
      'In the last 30 days, 28 people started booking this, 11 could choose a time, and 2 booked.',
    );
  });

  it('explains why there are more appointments than people', () => {
    const model = buildFlow(
      input({
        services: [service({ bookingMode: 'pack', packSize: 3 })],
        bookings: [booking('ana@x.com'), booking('ana@x.com'), booking('ana@x.com')],
      }),
    );
    expect(readout(model, model.lanes[0]!).asides).toContain(
      'That is 3 appointments, because it is a programme of 3 sessions.',
    );
  });

  it('counts existing clients apart, on their own line', () => {
    const model = buildFlow(
      input({
        services: [service({ availableToExistingClients: true })],
        bookings: [booking('ana@x.com'), booking('old@x.com', { byExistingClient: true })],
      }),
    );
    const r = readout(model, model.lanes[0]!);
    expect(r.text).toContain('and 1 booked.');
    expect(r.asides).toContain('1 person who was already a client also booked it, on their own link.');
  });

  it('says plainly when nobody can book it, and why', () => {
    const nobody = buildFlow(input({ services: [service({ availableToProspects: false })] }));
    expect(readout(nobody, nobody.lanes[0]!).text).toBe('Nobody can book this yet: it isn’t offered to anyone.');
    const noHours = buildFlow(input({ availabilityRuleCount: 0 }));
    expect(readout(noHours, noHours.lanes[0]!).text).toBe('Nobody can book this yet: you haven’t set any hours.');
  });
});

describe('serviceSteps', () => {
  const steps = (over: Partial<FlowInput> = {}, svc: Partial<FlowService> = {}) => {
    const model = buildFlow(input({ services: [service(svc)], ...over }));
    return serviceSteps(model, model.lanes[0]!, 'ruiz');
  };
  const step = (list: ReturnType<typeof steps>, id: string) => list.find((s) => s.id === id)!;

  it('is always the same four steps, in the order people take them', () => {
    expect(steps().map((s) => s.id)).toEqual(['find', 'questions', 'times', 'booked']);
  });

  it('counts people down the steps, and names appointments as appointments', () => {
    const list = steps(
      { bookings: [booking('ana@x.com'), booking('ana@x.com'), booking('ana@x.com')] },
      { bookingMode: 'pack', packSize: 3 },
    );
    expect(step(list, 'find').figure).toEqual({ value: '28', label: 'chose it' });
    expect(step(list, 'questions').figure).toEqual({ value: '24 of 28', label: 'finished' });
    expect(step(list, 'times')).toMatchObject({ title: 'They choose 3 times', figure: { value: '11', label: 'could choose' } });
    expect(step(list, 'booked').figure).toEqual({ value: '1', label: 'person', sub: '3 appointments' });
  });

  it('says a missing next-steps message in words, on the questions, with its fix', () => {
    const list = steps({ hasOtherPathMessage: false, hasOtherPathUrl: false });
    expect(step(list, 'questions').notes).toContainEqual({
      tone: 'need',
      text: '13 people were sent to your other next step, but it isn’t written yet, so they saw nothing.',
      action: { label: 'Write it', href: 'messages?m=next_steps' },
    });
  });

  it('says in words that existing clients are not offered it, instead of drawing a line', () => {
    expect(step(steps(), 'find').notes).toContainEqual({
      tone: 'info',
      text: 'Existing clients don’t see it on their own link.',
      action: { label: 'Offer it to them', href: 'sessions/s1' },
    });
  });

  it('draws a service offered to nobody with its first step missing, and the rest waiting', () => {
    const list = steps({}, { availableToProspects: false });
    expect(list.map((s) => s.state)).toEqual(['missing', 'waiting', 'waiting', 'waiting']);
    expect(step(list, 'find').change).toEqual({ label: 'Choose who sees it', href: 'sessions/s1' });
    expect(step(list, 'booked').figure).toBeNull();
  });

  it('draws no hours as the missing step, with the way to set them', () => {
    const list = steps({ availabilityRuleCount: 0 });
    expect(step(list, 'times')).toMatchObject({ state: 'missing', change: { label: 'Set your hours', href: 'week' } });
    expect(step(list, 'booked').state).toBe('waiting');
  });

  it('shows no questions as a choice, not a gap', () => {
    const list = steps({ globalQuestionCount: 0 });
    expect(step(list, 'questions')).toMatchObject({
      state: 'set',
      title: 'No questions',
      change: { label: 'Add questions', href: 'screening?service=s1' },
    });
  });

  it('skips the questions for a service only existing clients can book', () => {
    const list = steps({}, { availableToProspects: false, availableToExistingClients: true });
    expect(step(list, 'find').title).toBe('Existing clients find it on their own link');
    expect(step(list, 'questions').state).toBe('skipped');
  });
});

describe('the chips', () => {
  const chips = (over: Partial<FlowInput> = {}, svc: Partial<FlowService> = {}) => {
    const model = buildFlow(input({ services: [service(svc)], ...over }));
    return serviceSteps(model, model.lanes[0]!, 'ruiz');
  };

  it('names each chip in two or three words', () => {
    expect(chips().map((s) => s.label)).toEqual(['Your page', 'Questions', 'Choose a time', 'Booked']);
  });

  it('puts a few words on the chip where something needs doing, and nowhere else', () => {
    expect(chips().map((s) => s.flag)).toEqual([null, null, null, null]);
    expect(chips({ hasOtherPathMessage: false, hasOtherPathUrl: false })[1]!.flag).toBe('Next step not written');
    expect(chips({ availabilityRuleCount: 0 })[2]!.flag).toBe('No hours yet');
    expect(chips({}, { availableToProspects: false })[0]!.flag).toBe('Not offered yet');
  });

  it('says "Waiting" on the chips after a missing one, with no count and no flag', () => {
    const list = chips({ availabilityRuleCount: 0 });
    expect(list[3]).toMatchObject({ state: 'waiting', short: 'Waiting', figure: null, flag: null });
  });
});

describe('stepForPart', () => {
  it('opens the right step from an older link or a test run', () => {
    expect(['page', 'service:s1', 'questions', 'elsewhere', 'calendar', 'booked', 'nope'].map(stepForPart)).toEqual([
      'find',
      'find',
      'questions',
      'questions',
      'times',
      'booked',
      null,
    ]);
  });
});
