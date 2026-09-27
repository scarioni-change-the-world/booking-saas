import { describe, expect, it } from 'vitest';
import { buildReport, type ReportBooking, type ReportInput } from '../src/lib/reports';

/* A small practice in UTC, read on 30 September 2026 for September. */
const NOW = '2026-09-30T20:00:00Z';
const coaching = {
  id: 'coach',
  name: 'Coaching',
  priceMinor: 9000,
  durationMinutes: 60,
  bookingMode: 'single' as const,
  packSize: null,
};
const intro = {
  id: 'intro',
  name: 'Intro call',
  priceMinor: 2000,
  durationMinutes: 60,
  bookingMode: 'single' as const,
  packSize: null,
};

let n = 0;
function booking(over: Partial<ReportBooking> & { startsAt: string }): ReportBooking {
  n += 1;
  const start = new Date(over.startsAt).getTime();
  return {
    id: `b${n}`,
    createdAt: new Date(start - 3 * 86400000).toISOString(),
    endsAt: new Date(start + 3600000).toISOString(),
    status: 'confirmed',
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    eventTypeId: 'coach',
    email: `c${n}@x.com`,
    name: `Client ${n}`,
    packId: null,
    packSize: null,
    source: 'instagram',
    attendance: null,
    rescheduleCount: 0,
    paymentId: null,
    viaClientLink: false,
    ...over,
  };
}

/** Open Tuesday 18:00–20:00 and Friday 09:00–13:00, every week of September. */
function openDays(from: string, to: string) {
  const out = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d = new Date(d.getTime() + 86400000)
  ) {
    const weekday = ((d.getUTCDay() + 6) % 7) + 1;
    const windows =
      weekday === 2
        ? [{ startMinutes: 18 * 60, endMinutes: 20 * 60 }]
        : weekday === 5
          ? [{ startMinutes: 9 * 60, endMinutes: 13 * 60 }]
          : [];
    out.push({ date: d.toISOString().slice(0, 10), weekday, windows });
  }
  return out;
}

function input(bookings: ReportBooking[], over: Partial<ReportInput> = {}): ReportInput {
  return {
    timezone: 'UTC',
    now: NOW,
    period: { from: '2026-09-01', to: '2026-09-30' },
    previous: { from: '2026-08-02', to: '2026-08-31' },
    noticeHours: 24,
    services: [coaching, intro],
    bookings,
    responses: [],
    visits: [],
    payments: [],
    ratings: [],
    openDays: openDays('2026-09-01', '2026-09-30'),
    previousOpenDays: openDays('2026-08-02', '2026-08-31'),
    visitsTracked: true,
    ...over,
  };
}

// Every Tuesday evening in September is booked (both hours); Fridays are empty.
const tuesdays = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'].flatMap((d) => [
  booking({ startsAt: `${d}T18:00:00Z` }),
  booking({ startsAt: `${d}T19:00:00Z`, eventTypeId: 'intro' }),
]);

describe('buildReport', () => {
  it('adds up the month: sessions, hours, value, use of open time', () => {
    const r = buildReport(input(tuesdays));
    expect(r.headline.sessionsHeld.value).toBe(10);
    expect(r.headline.hoursBooked.value).toBe(10);
    // 5 Tuesdays × 2h + 4 Fridays × 4h = 26 open hours.
    expect(r.headline.hoursOpen.value).toBe(26);
    expect(r.headline.utilisation.value).toBeCloseTo(10 / 26);
    expect(r.headline.valueEarnedMinor.value).toBe(5 * 9000 + 5 * 2000);
  });

  it('sees that Tuesday evenings are full and Friday mornings empty, and says so', () => {
    const r = buildReport(input(tuesdays));
    expect(r.demand.full[0]).toMatchObject({ weekday: 2, part: 'evening', fill: 1 });
    // 09:00–12:00 is morning (12:00–13:00 is afternoon): 3 hours × 4 Fridays.
    expect(r.demand.quiet[0]).toMatchObject({ weekday: 5, part: 'morning', openHours: 12, bookedHours: 0 });
    const ids = r.findings.map((f) => f.id);
    expect(ids).toContain('band-full');
    expect(ids).toContain('band-quiet');
    expect(r.findings.find((f) => f.id === 'band-quiet')!.tone).toBe('need');
  });

  it('compares services by what an hour of your time earns', () => {
    const r = buildReport(input(tuesdays));
    const coach = r.services.find((s) => s.id === 'coach')!;
    const call = r.services.find((s) => s.id === 'intro')!;
    expect(coach.valuePerHourMinor).toBe(9000);
    expect(call.valuePerHourMinor).toBe(2000);
    expect(r.findings.find((f) => f.id === 'low-value-service')?.title).toMatch(
      /Intro call earns €20 an hour; Coaching €90/,
    );
  });

  it('counts no-shows only among sessions marked, and flags a high rate', () => {
    const marked = tuesdays.map((b, i) => ({
      ...b,
      attendance: i < 3 ? ('no_show' as const) : ('attended' as const),
    }));
    const r = buildReport(input(marked));
    expect(r.cancellations.noShows).toBe(3);
    expect(r.cancellations.noShowRate).toBeCloseTo(0.3);
    expect(r.headline.sessionsHeld.value).toBe(7);
    expect(r.findings.map((f) => f.id)).toContain('no-shows');
  });

  it('reads cancellations: who, how late, and why', () => {
    const cancelled = [
      booking({
        startsAt: '2026-09-15T18:00:00Z',
        status: 'cancelled',
        cancelledAt: '2026-09-15T08:00:00Z',
        cancelledBy: 'client',
        cancellationReason: 'Sick',
      }),
      booking({
        startsAt: '2026-09-22T18:00:00Z',
        status: 'cancelled',
        cancelledAt: '2026-09-10T08:00:00Z',
        cancelledBy: 'business',
      }),
    ];
    const r = buildReport(input(cancelled));
    expect(r.cancellations).toMatchObject({ count: 2, byClient: 1, byBusiness: 1, late: 1 });
    expect(r.cancellations.reasons[0]).toMatchObject({
      reason: 'Sick',
      serviceName: 'Coaching',
      by: 'client',
    });
  });

  it('follows the journey from visit to booking and finds where people leave', () => {
    const visits = Array.from({ length: 50 }, (_, i) => ({
      visitedAt: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
      source: i < 30 ? 'instagram' : 'google',
      surface: 'page' as const,
    }));
    const responses = Array.from({ length: 12 }, (_, i) => ({
      createdAt: '2026-09-10T10:00:00Z',
      completedAt: '2026-09-10T10:05:00Z',
      eventTypeId: 'coach',
      outcomePathType: i < 4 ? ('meeting' as const) : ('other' as const),
      answers: [
        {
          questionId: 'q1',
          prompt: 'What is your budget?',
          answer: i < 4 ? 'Over €1,000' : 'Under €1,000',
          outcomePathType: i < 4 ? ('meeting' as const) : ('other' as const),
        },
      ],
    }));
    const r = buildReport(input(tuesdays, { visits, responses }));
    expect(r.funnel.steps.map((s) => [s.id, s.count])).toEqual([
      ['visited', 50],
      ['started', 12],
      ['through', 4],
      // The two 1 September sessions were booked in August.
      ['booked', 8],
    ]);
    expect(r.funnel.worstDrop).toMatchObject({ from: 'visited', to: 'started', lost: 38 });
    const ids = r.findings.map((f) => f.id);
    expect(ids).toContain('visitors-leave');
    expect(r.findings.find((f) => f.id === 'questions-send-away')?.detail).toMatch(
      /What is your budget\?.*Under €1,000/,
    );
    const insta = r.sources.find((s) => s.source === 'instagram')!;
    expect(insta).toMatchObject({ visits: 30, bookings: 8 });
  });

  it('finds clients who have gone quiet and programmes that stalled', () => {
    const regular = [
      booking({ startsAt: '2026-06-02T18:00:00Z', email: 'ana@x.com', name: 'Ana' }),
      booking({ startsAt: '2026-07-07T18:00:00Z', email: 'ana@x.com', name: 'Ana' }),
    ];
    const pack = [
      booking({
        startsAt: '2026-08-04T18:00:00Z',
        email: 'leo@x.com',
        name: 'Leo',
        packId: 'p1',
        packSize: 3,
      }),
    ];
    const r = buildReport(input([...regular, ...pack]));
    expect(r.clients.quiet.map((c) => c.email)).toContain('ana@x.com');
    expect(r.clients.programmes.stalled[0]).toMatchObject({ email: 'leo@x.com', owed: 2 });
  });

  it('never leaves a note it has too little to go on for', () => {
    const r = buildReport(
      input([booking({ startsAt: '2026-09-15T18:00:00Z' })], { openDays: [], previousOpenDays: [] }),
    );
    expect(
      r.findings.filter(
        (f) => f.id === 'no-shows' || f.id === 'low-value-service' || f.id === 'visitors-leave',
      ),
    ).toEqual([]);
  });

  it('compares with the period before', () => {
    const august = [booking({ startsAt: '2026-08-11T18:00:00Z', createdAt: '2026-08-05T10:00:00Z' })];
    const r = buildReport(input([...tuesdays, ...august]));
    expect(r.headline.sessionsHeld).toEqual({ value: 10, previous: 1 });
  });
});
