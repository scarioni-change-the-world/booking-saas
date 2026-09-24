import { describe, expect, it } from 'vitest';
import {
  appointmentLabel,
  buildPeople,
  figureAnswers,
  filterCounts,
  matchesSearch,
  visibleTrace,
  type PeopleBooking,
  type PeopleClient,
  type PeopleInput,
  type PeopleResponse,
  type TraceStep,
} from '@/lib/people';

const NOW = '2026-09-24T10:00:00Z'; // Thursday, 12:00 in Madrid
const TZ = 'Europe/Madrid';

function input(parts: Partial<PeopleInput>): PeopleInput {
  return { timezone: TZ, windowStart: '2025-09-24T00:00:00Z', clients: [], bookings: [], responses: [], ...parts };
}

function response(over: Partial<PeopleResponse>): PeopleResponse {
  return {
    id: 'r1',
    email: 'maya@example.com',
    serviceName: 'Portrait session',
    startedAt: '2026-09-20T09:00:00Z',
    completedAt: '2026-09-20T09:03:00Z',
    outcomePathType: 'meeting',
    answers: [],
    reconsidered: null,
    returning: false,
    ...over,
  };
}

function booking(over: Partial<PeopleBooking>): PeopleBooking {
  return {
    id: 'b1',
    name: 'Maya',
    email: 'maya@example.com',
    eventTypeName: 'Portrait session',
    startsAt: '2026-09-29T08:00:00Z',
    endsAt: '2026-09-29T09:00:00Z',
    createdAt: '2026-09-20T09:04:00Z',
    status: 'confirmed',
    packId: null,
    packSize: null,
    ...over,
  };
}

function client(over: Partial<PeopleClient>): PeopleClient {
  return {
    id: 'c1',
    name: 'Maya',
    email: 'maya@example.com',
    accessToken: 'tok',
    notes: null,
    createdAt: '2026-09-20T09:04:00Z',
    entitlements: [],
    ...over,
  };
}

const labels = (trace: TraceStep[]) => trace.map((s) => s.label);

describe('one person, however they arrived', () => {
  it('folds an answer, a booking and a client record with the same email into one row', () => {
    const people = buildPeople(
      input({
        responses: [response({})],
        bookings: [booking({ email: 'Maya@Example.com' })],
        clients: [client({})],
      }),
      NOW,
    );
    expect(people).toHaveLength(1);
    expect(people[0]!.name).toBe('Maya');
    expect(labels(people[0]!.trace)).toEqual(['Answered', 'Portrait session']);
  });

  it('keeps an answer with no email as somebody of its own', () => {
    const people = buildPeople(
      input({ responses: [response({ id: 'x', email: null }), response({ id: 'y', email: null })] }),
      NOW,
    );
    expect(people.map((p) => p.key).sort()).toEqual(['response:x', 'response:y']);
  });

  it('puts whoever did something most recently first', () => {
    const people = buildPeople(
      input({
        responses: [
          response({ id: 'old', email: 'old@example.com', startedAt: '2026-09-01T09:00:00Z', completedAt: '2026-09-01T09:05:00Z' }),
          response({ id: 'new', email: 'new@example.com', startedAt: '2026-09-23T09:00:00Z', completedAt: '2026-09-23T09:05:00Z' }),
        ],
      }),
      NOW,
    );
    expect(people.map((p) => p.email)).toEqual(['new@example.com', 'old@example.com']);
  });
});

describe('the route', () => {
  it('names the answer that sent someone elsewhere', () => {
    const [p] = buildPeople(
      input({
        responses: [
          response({
            outcomePathType: 'other',
            answers: [
              { questionId: 'q1', prompt: 'What is the shoot for?', answer: 'Family', outcomePathType: null },
              { questionId: 'q2', prompt: 'Budget?', answer: 'Under €300', outcomePathType: 'other' },
            ],
          }),
        ],
      }),
      NOW,
    );
    expect(p!.trace[0]).toEqual({ tone: 'elsewhere', label: 'Sent elsewhere', detail: 'Under €300' });
    expect(p!.filters).toContain('elsewhere');
  });

  it('tells someone answering right now from someone who left', () => {
    const [now] = buildPeople(input({ responses: [response({ completedAt: null, startedAt: '2026-09-24T09:30:00Z' })] }), NOW);
    const [gone] = buildPeople(input({ responses: [response({ completedAt: null, startedAt: '2026-09-22T09:30:00Z' })] }), NOW);
    expect(now!.trace[0]!.label).toBe('Answering now');
    expect(gone!.trace[0]!.label).toBe('Didn’t finish');
    expect(gone!.filters).toEqual(['unfinished']);
  });

  it('says how long after being sent elsewhere someone answered again', () => {
    const [p] = buildPeople(
      input({
        responses: [
          response({ id: 'a', outcomePathType: 'other', completedAt: '2026-09-20T09:03:00Z' }),
          response({
            id: 'b',
            startedAt: '2026-09-20T09:05:00Z',
            completedAt: '2026-09-20T09:07:00Z',
            reconsidered: { redirectedAt: '2026-09-20T09:03:00Z', minutesBetween: 4, earlierAttempts: 1, changed: [] },
          }),
        ],
      }),
      NOW,
    );
    expect(labels(p!.trace)).toEqual(['Sent elsewhere', 'Answered again 4 minutes later']);
    expect(p!.answeredAgain).toBe(true);
    expect(p!.filters).toContain('again');
  });

  it('draws a programme as one step that says how far along it is', () => {
    const pack = (id: string, day: number, status: 'confirmed' | 'cancelled' = 'confirmed') =>
      booking({
        id,
        packId: 'p1',
        packSize: 3,
        status,
        startsAt: `2026-09-${day}T08:00:00Z`,
        endsAt: `2026-09-${day}T09:00:00Z`,
        createdAt: '2026-09-01T10:00:00Z',
      });
    const [p] = buildPeople(input({ bookings: [pack('a', 10), pack('b', 17), pack('c', 29)] }), NOW);
    expect(p!.trace).toEqual([
      { tone: 'booked', label: 'Portrait session programme', detail: '2 of 3 done · next Tue 10:00' },
    ]);
    // The panel still has every appointment, numbered in time order.
    expect(p!.events.map((e) => (e.kind === 'booked' ? e.packIndex : null))).toEqual([1, 2, 3]);
  });

  it('ends the route on the sessions still owed, drawn as missing', () => {
    const [p] = buildPeople(
      input({
        clients: [
          client({
            entitlements: [
              { id: 'e1', eventTypeId: 't', eventTypeName: 'Portrait session', totalSessions: 3, usedSessions: 2 },
              { id: 'e2', eventTypeId: 'u', eventTypeName: 'Edit', totalSessions: 1, usedSessions: 1 },
            ],
          }),
        ],
        bookings: [booking({})],
      }),
      NOW,
    );
    expect(p!.trace.at(-1)).toEqual({ tone: 'owed', label: '1 not booked', detail: 'Portrait session' });
    expect(p!.owed).toEqual([{ entitlementId: 'e1', eventTypeName: 'Portrait session', remaining: 1 }]);
    expect(p!.filters).toContain('owed');
  });

  it('shows a client the business added by hand, but not the record a booking made', () => {
    const [byHand] = buildPeople(input({ clients: [client({ createdAt: '2026-09-01T10:00:00Z' })] }), NOW);
    expect(byHand!.trace).toEqual([{ tone: 'added', label: 'Added by you', detail: '1 Sep' }]);

    const [byBooking] = buildPeople(input({ clients: [client({})], bookings: [booking({})] }), NOW);
    expect(labels(byBooking!.trace)).toEqual(['Portrait session']);
  });

  it('says a link was given, not a person added, when it came after a booking', () => {
    const [p] = buildPeople(
      input({
        clients: [client({ createdAt: '2026-09-22T10:00:00Z' })],
        bookings: [booking({ createdAt: '2026-07-01T10:00:00Z', startsAt: '2026-07-08T08:00:00Z', endsAt: '2026-07-08T09:00:00Z' })],
      }),
      NOW,
    );
    expect(labels(p!.trace)).toEqual(['Portrait session', 'Given their own link']);
  });

  it('does not say "programme" twice for a service already called one', () => {
    const [p] = buildPeople(
      input({ bookings: [booking({ eventTypeName: 'Portrait programme', packId: 'p', packSize: 3 })] }),
      NOW,
    );
    expect(p!.trace[0]!.label).toBe('Portrait programme');
  });

  it('says how long someone has been a client when that is older than what was read', () => {
    const [p] = buildPeople(input({ clients: [client({ createdAt: '2024-03-02T10:00:00Z' })] }), NOW);
    expect(labels(p!.trace)).toEqual(['Client since March 2024']);
  });
});

describe('came back', () => {
  it('is someone who answered the questions while already a client', () => {
    const [p] = buildPeople(input({ responses: [response({ returning: true })] }), NOW);
    expect(p!.cameBack).toBe(true);
  });

  it('is someone who booked again on a later visit', () => {
    const [p] = buildPeople(
      input({
        bookings: [
          booking({ id: 'a', createdAt: '2026-06-01T10:00:00Z' }),
          booking({ id: 'b', createdAt: '2026-09-20T10:00:00Z' }),
        ],
      }),
      NOW,
    );
    expect(p!.cameBack).toBe(true);
  });

  it('is not somebody who booked a whole programme in one go', () => {
    const [p] = buildPeople(
      input({
        bookings: [
          booking({ id: 'a', packId: 'p', packSize: 2 }),
          booking({ id: 'b', packId: 'p', packSize: 2, startsAt: '2026-10-06T08:00:00Z', endsAt: '2026-10-06T09:00:00Z' }),
        ],
      }),
      NOW,
    );
    expect(p!.cameBack).toBe(false);
  });
});

describe('where someone stopped', () => {
  it('flags someone the questions let through who has not booked', () => {
    const [p] = buildPeople(input({ responses: [response({})] }), NOW);
    expect(p!.filters).toEqual(['notbooked']);
  });

  it('stops flagging once they book', () => {
    const [p] = buildPeople(input({ responses: [response({})], bookings: [booking({})] }), NOW);
    expect(p!.filters).toEqual(['booked']);
  });

  it('does not call someone who booked and cancelled a person who never booked', () => {
    const [p] = buildPeople(input({ responses: [response({})], bookings: [booking({ status: 'cancelled' })] }), NOW);
    expect(p!.filters).toEqual([]);
    expect(p!.trace.at(-1)!.tone).toBe('cancelled');
  });

  it('reads only the latest answer: sent elsewhere, then let through, is let through', () => {
    const [p] = buildPeople(
      input({
        responses: [
          response({ id: 'a', outcomePathType: 'other' }),
          response({ id: 'b', startedAt: '2026-09-21T09:00:00Z', completedAt: '2026-09-21T09:02:00Z' }),
        ],
      }),
      NOW,
    );
    expect(p!.filters).not.toContain('elsewhere');
    expect(p!.filters).toContain('notbooked');
  });
});

describe('appointmentLabel', () => {
  it('names a day this coming week by weekday and time, in the business zone', () => {
    expect(appointmentLabel('2026-09-29T08:00:00Z', TZ, NOW)).toBe('Tue 10:00');
  });

  it('dates anything further off or past', () => {
    expect(appointmentLabel('2026-10-20T08:00:00Z', TZ, NOW)).toBe('20 Oct');
    expect(appointmentLabel('2026-09-01T08:00:00Z', TZ, NOW)).toBe('1 Sep');
  });

  it('adds the year only when it is not this one', () => {
    expect(appointmentLabel('2025-12-01T08:00:00Z', TZ, NOW)).toBe('1 Dec 2025');
  });
});

describe('visibleTrace', () => {
  const steps = (n: number): TraceStep[] =>
    Array.from({ length: n }, (_, i) => ({ tone: 'booked', label: `s${i + 1}`, detail: null }));

  it('leaves a short route alone', () => {
    expect(visibleTrace(steps(5))).toHaveLength(5);
  });

  it('folds the start of a long one into a single earlier step', () => {
    const shown = visibleTrace(steps(9));
    expect(shown).toHaveLength(5);
    expect(shown[0]).toEqual({ tone: 'more', label: '5 earlier', detail: null });
    expect(shown.at(-1)!.label).toBe('s9');
  });
});

describe('chips and search', () => {
  const people = buildPeople(
    input({
      responses: [response({}), response({ id: 'r2', email: 'jo@example.com', outcomePathType: 'other' })],
      bookings: [booking({ email: 'sam@example.com', name: 'Sam' })],
    }),
    NOW,
  );

  it('counts each filter by people, not by answers', () => {
    const counts = filterCounts(people);
    expect(counts.all).toBe(3);
    expect(counts.booked).toBe(1);
    expect(counts.elsewhere).toBe(1);
    expect(counts.notbooked).toBe(1);
  });

  it('finds people by name or email', () => {
    expect(people.filter((p) => matchesSearch(p, 'SAM')).map((p) => p.email)).toEqual(['sam@example.com']);
    expect(people.filter((p) => matchesSearch(p, 'jo@')).map((p) => p.email)).toEqual(['jo@example.com']);
    expect(people.filter((p) => matchesSearch(p, '  '))).toHaveLength(3);
  });
});

describe('figureAnswers', () => {
  const since = '2026-08-25T10:00:00Z';
  const [p] = buildPeople(
    input({
      responses: [
        response({ id: 'a', outcomePathType: 'other' }),
        response({ id: 'b', startedAt: '2026-09-21T09:00:00Z', completedAt: '2026-09-21T09:02:00Z' }),
        response({ id: 'old', outcomePathType: 'other', startedAt: '2026-07-01T09:00:00Z', completedAt: '2026-07-01T09:02:00Z' }),
        response({ id: 'back', returning: true, startedAt: '2026-09-22T09:00:00Z', completedAt: '2026-09-22T09:02:00Z' }),
      ],
    }),
    NOW,
  );

  it('counts the answers behind a figure, inside its window only', () => {
    expect(figureAnswers(p!, 'other', since)).toBe(1);
  });

  it('keeps returning answers out of the new-enquiry figures, as Overview does', () => {
    expect(figureAnswers(p!, 'meeting', since)).toBe(1);
    expect(figureAnswers(p!, 'returning', since)).toBe(1);
  });
});
