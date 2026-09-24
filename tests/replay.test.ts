import { describe, expect, it } from 'vitest';
import { outcomeUnder, replay, routingChanged, type ReplayQuestion, type ReplayResponse } from '@/lib/replay';

const budget: ReplayQuestion = {
  id: 'q-budget',
  kind: 'single_choice',
  options: [
    { label: 'Under €300', outcomePathType: 'other' },
    { label: '€300 to €800', outcomePathType: 'meeting' },
  ],
};
const purpose: ReplayQuestion = {
  id: 'q-purpose',
  kind: 'single_choice',
  options: [
    { label: 'A family portrait', outcomePathType: 'meeting' },
    { label: 'Just looking for prices', outcomePathType: 'other' },
  ],
};

let n = 0;
function r(budgetAnswer: string, purposeAnswer = 'A family portrait', booked = false, eventTypeId = 's1'): ReplayResponse {
  n += 1;
  return {
    id: `r${n}`,
    eventTypeId,
    booked,
    answers: [
      { questionId: 'q-purpose', answer: purposeAnswer, outcomePathType: null },
      { questionId: 'q-budget', answer: budgetAnswer, outcomePathType: null },
    ],
  };
}

const openBudget: ReplayQuestion = {
  ...budget,
  options: budget.options.map((o) => ({ ...o, outcomePathType: 'meeting' as const })),
};

describe('outcomeUnder', () => {
  it('sends someone elsewhere when any one answer leads there', () => {
    const rules = new Map([budget, purpose].map((q) => [q.id, q]));
    expect(outcomeUnder(r('€300 to €800'), rules)).toBe('meeting');
    expect(outcomeUnder(r('€300 to €800', 'Just looking for prices'), rules)).toBe('other');
  });

  it('falls back to where an answer led at the time when its option has since gone', () => {
    const rules = new Map([[budget.id, budget]]);
    const old: ReplayResponse = {
      id: 'x',
      eventTypeId: 's1',
      booked: false,
      answers: [{ questionId: 'q-budget', answer: 'Under €200 (renamed since)', outcomePathType: 'other' }],
    };
    expect(outcomeUnder(old, rules)).toBe('other');
  });
});

describe('replay', () => {
  const month = [
    r('Under €300'),
    r('Under €300'),
    r('Under €300', 'Just looking for prices'),
    r('€300 to €800', 'A family portrait', true),
    r('€300 to €800', 'A family portrait', true),
    r('€300 to €800'),
    r('€300 to €800'),
  ];

  it('counts before and after under today’s rules, with only the edited question swapped', () => {
    const result = replay(month, [budget, purpose], openBudget, null);
    expect(result.answered).toBe(7);
    expect(result.before).toEqual({ calendar: 4, elsewhere: 3 });
    // The "just looking" person is still turned away by the other question.
    expect(result.after).toEqual({ calendar: 6, elsewhere: 1 });
    expect(result.nowLetThrough).toBe(2);
    expect(result.nowTurnedAway).toBe(0);
  });

  it('estimates the extra bookings at last month’s rate, and says what that rate was', () => {
    const result = replay(month, [budget, purpose], openBudget, null);
    expect(result.bookingRate).toBe(0.5); // 2 of the 4 let through booked
    expect(result.bookingsBefore).toBe(2);
    expect(result.bookingsGained).toBe(1);
  });

  it('names the real bookings a tighter rule would have turned away', () => {
    const tighter: ReplayQuestion = {
      ...budget,
      options: budget.options.map((o) => ({ ...o, outcomePathType: 'other' as const })),
    };
    const result = replay(month, [budget, purpose], tighter, null);
    expect(result.nowTurnedAway).toBe(4);
    expect(result.bookingsLost).toBe(2);
    expect(result.after.calendar).toBe(0);
  });

  it('counts only the people who were asked the edited question', () => {
    const other: ReplayResponse = { id: 'z', eventTypeId: 's2', booked: true, answers: [] };
    expect(replay([...month, other], [budget, purpose], openBudget, null).answered).toBe(7);
  });

  it('works out whether the time booked would have fitted the open hours', () => {
    const roomy = replay(month, [budget, purpose], openBudget, {
      openMinutes: 600,
      bookedMinutes: 120,
      durations: { s1: 60 },
    });
    expect(roomy.capacity).toEqual({ openMinutes: 600, usedBefore: 120, usedAfter: 180, shortBy: 0 });

    const tight = replay(month, [budget, purpose], openBudget, {
      openMinutes: 150,
      bookedMinutes: 120,
      durations: { s1: 60 },
    });
    expect(tight.capacity!.shortBy).toBe(30);
  });

  it('has nothing to say about capacity when there are no open hours to compare with', () => {
    expect(replay(month, [budget, purpose], openBudget, { openMinutes: 0, bookedMinutes: 0, durations: {} }).capacity).toBeNull();
  });
});

describe('routingChanged', () => {
  it('is false for a draft that only reworded nothing', () => {
    expect(routingChanged(budget, { ...budget })).toBe(false);
  });
  it('is true when an answer now leads somewhere else', () => {
    expect(routingChanged(budget, openBudget)).toBe(true);
  });
});
