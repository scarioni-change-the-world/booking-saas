import { describe, expect, it } from 'vitest';
import {
  STEP_LABELS,
  applicableSteps,
  articleFor,
  previousStep,
  stepPosition,
} from '@/components/booking/journey';
import {
  DATES_PER_PAGE,
  groupSlots,
  pageContaining,
  pageCount,
  pageSlice,
  periodOf,
} from '@/components/booking/slots';

const FULL = { serviceChoice: true, questions: true };
const BARE = { serviceChoice: false, questions: false };

describe('applicableSteps', () => {
  it('counts only the steps this business actually puts a client through', () => {
    expect(applicableSteps(FULL)).toEqual([
      'service',
      'questions',
      'time',
      'details',
      'review',
      'confirmed',
    ]);
    expect(applicableSteps(BARE)).toEqual(['time', 'details', 'review', 'confirmed']);
  });

  it('drops the service step for a business with one service', () => {
    expect(applicableSteps({ serviceChoice: false, questions: true })).not.toContain('service');
  });

  it('drops the questions step for a service that asks nothing', () => {
    expect(applicableSteps({ serviceChoice: true, questions: false })).not.toContain('questions');
  });

  it('never promises a longer journey than the client has', () => {
    expect(applicableSteps(BARE).length).toBeLessThan(applicableSteps(FULL).length);
  });
});

describe('stepPosition', () => {
  it('is 1-based, so "1 of 4" and not "0 of 4"', () => {
    const steps = applicableSteps(BARE);
    expect(stepPosition(steps, 'time')).toBe(1);
    expect(stepPosition(steps, 'confirmed')).toBe(4);
  });

  it('is 0 for a step outside this journey', () => {
    expect(stepPosition(applicableSteps(BARE), 'questions')).toBe(0);
  });
});

describe('previousStep', () => {
  it('walks back through the steps that apply, skipping the ones that do not', () => {
    const steps = applicableSteps({ serviceChoice: true, questions: false });
    expect(previousStep(steps, 'time')).toBe('service');
  });

  it('has nowhere to go from the first step', () => {
    expect(previousStep(applicableSteps(BARE), 'time')).toBeNull();
  });

  /* The booking exists by now. A Back button here would invite somebody to
     try to navigate out of a commitment that has already been made, emailed
     and written to a calendar. */
  it('has nowhere to go from a confirmed booking', () => {
    expect(previousStep(applicableSteps(FULL), 'confirmed')).toBeNull();
  });
});

describe('periodOf', () => {
  const at = (hour: number) => {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  it('splits the day at noon and five', () => {
    expect(periodOf(at(9))).toBe('morning');
    expect(periodOf(at(11))).toBe('morning');
    expect(periodOf(at(12))).toBe('afternoon');
    expect(periodOf(at(16))).toBe('afternoon');
    expect(periodOf(at(17))).toBe('evening');
    expect(periodOf(at(20))).toBe('evening');
  });
});

describe('groupSlots', () => {
  const at = (hour: number, minute = 0) => {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  it('keeps the parts of the day in the order they happen', () => {
    const groups = groupSlots([at(18), at(9), at(14)]);
    expect(groups.map((g) => g.period)).toEqual(['morning', 'afternoon', 'evening']);
  });

  /* An empty "Evening" heading reads as a section that failed to load, not
     as a business that stops at five. */
  it('leaves out a part of the day with nothing in it', () => {
    const groups = groupSlots([at(9), at(10)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('Morning');
  });

  it('loses no slots', () => {
    const slots = [at(9), at(9, 30), at(13), at(19), at(19, 30)];
    const grouped = groupSlots(slots).flatMap((g) => g.slots);
    expect(grouped.sort()).toEqual([...slots].sort());
  });

  it('has nothing to show for a day with no openings', () => {
    expect(groupSlots([])).toEqual([]);
  });
});

describe('date paging', () => {
  const days = Array.from({ length: 17 }, (_, i) => ({
    date: `2026-03-${String(i + 1).padStart(2, '0')}`,
    slots: [] as string[],
  }));

  it('breaks a long run of dates into pages', () => {
    expect(pageCount(days)).toBe(3);
    expect(pageSlice(days, 0)).toHaveLength(DATES_PER_PAGE);
  });

  it('finds the page a chosen date sits on, so the navigator opens where the client is', () => {
    expect(pageContaining(days, '2026-03-01')).toBe(0);
    expect(pageContaining(days, '2026-03-08')).toBe(1);
    expect(pageContaining(days, '2026-03-15')).toBe(2);
  });

  it('falls back to the first page for a date that is not offered', () => {
    expect(pageContaining(days, '2026-12-25')).toBe(0);
    expect(pageContaining(days, null)).toBe(0);
  });

  /* Arrows that work but show nothing look exactly like a bug, so the last
     page is short rather than empty. */
  it('clamps rather than running off the end', () => {
    expect(pageSlice(days, 99)).toEqual(days.slice(14));
    expect(pageSlice(days, -3)).toEqual(days.slice(0, DATES_PER_PAGE));
  });

  it('has no pages at all when there are no dates', () => {
    expect(pageCount([])).toBe(0);
    expect(pageSlice([], 0)).toEqual([]);
  });
});

describe('step labels', () => {
  /* The vocabulary rule, enforced rather than remembered: this is the one
     surface a stranger reads, and none of it should name the machinery. */
  it('names nothing after the mechanism', () => {
    const banned = ['qualify', 'unqualified', 'screen', 'filter', 'lead', 'event type'];
    for (const label of Object.values(STEP_LABELS)) {
      for (const word of banned) {
        expect(label.toLowerCase()).not.toContain(word);
      }
    }
  });
});

describe('articleFor', () => {
  /* Pack sizes are data, so "a 8-session package" is what concatenation
     gives you. English takes "an" before a vowel sound, which is about how
     the number is spoken, not how it is spelled. */
  it('takes "an" before eight, eleven and eighteen', () => {
    expect(articleFor(8)).toBe('an');
    expect(articleFor(11)).toBe('an');
    expect(articleFor(18)).toBe('an');
  });

  it('takes "an" for anything beginning with one of those', () => {
    expect(articleFor(80)).toBe('an');
    expect(articleFor(18)).toBe('an');
    expect(articleFor(110)).toBe('an');
  });

  it('takes "a" everywhere else, including the traps', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 9, 10, 12, 15, 20, 50, 100]) {
      expect(articleFor(n)).toBe('a');
    }
  });

  /* "a one-session package" — one is spoken "wun", so it is not a vowel
     sound however it looks. */
  it('takes "a" before one', () => {
    expect(articleFor(1)).toBe('a');
  });
});
