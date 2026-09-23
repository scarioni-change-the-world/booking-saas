import { describe, expect, it } from 'vitest';
import { alreadyKnown, analyseQuestions, analyseServices, knownSinceMap, share, type AnalysedResponse } from '@/lib/enquiry-analysis';

const BUDGET = 'What is your budget?';
const TIMING = 'When would you like to start?';

const a = (
  questionId: string,
  prompt: string,
  answer: string,
  outcomePathType: 'meeting' | 'other' | null = 'meeting',
) => ({ questionId, prompt, answer, outcomePathType });

const response = (
  outcome: 'meeting' | 'other' | null,
  answers: ReturnType<typeof a>[],
  overrides: Partial<AnalysedResponse> = {},
): AnalysedResponse => ({
  eventTypeId: 'service-1',
  completedAt: '2026-03-01T10:00:00.000Z',
  outcomePathType: outcome,
  answers,
  ...overrides,
});

describe('analyseQuestions', () => {
  it('counts how many people each question sent away', () => {
    const [insight] = analyseQuestions([
      response('other', [a('q1', BUDGET, 'Under €1,000', 'other')]),
      response('other', [a('q1', BUDGET, 'Under €1,000', 'other')]),
      response('meeting', [a('q1', BUDGET, '€5,000+')]),
    ]);

    expect(insight).toMatchObject({ prompt: BUDGET, answered: 3, sentElsewhere: 2 });
  });

  /* "20 of 34 were sent away here" is a finding. "And 18 of them said Under
     €1,000" is a decision. */
  it('names the answer doing the sending, commonest first', () => {
    const [insight] = analyseQuestions([
      response('other', [a('q1', BUDGET, 'Under €1,000', 'other')]),
      response('other', [a('q1', BUDGET, 'Under €1,000', 'other')]),
      response('other', [a('q1', BUDGET, 'Under €500', 'other')]),
    ]);

    expect(insight!.routingAnswers).toEqual([
      { answer: 'Under €1,000', count: 2 },
      { answer: 'Under €500', count: 1 },
    ]);
  });

  /* A business opening this page is looking for the question costing them
     meetings, and it should be the first thing on it. */
  it('puts the biggest filter at the top', () => {
    const insights = analyseQuestions([
      response('other', [
        a('q1', BUDGET, 'Under €1,000', 'other'),
        a('q2', TIMING, 'Just exploring', 'other'),
      ]),
      response('other', [a('q1', BUDGET, 'Under €1,000', 'other'), a('q2', TIMING, 'Soon')]),
    ]);

    expect(insights.map((i) => i.prompt)).toEqual([BUDGET, TIMING]);
  });

  /* Somebody who abandoned the form never got an outcome. Counting them
     would make every question look like it was turning people away. */
  it('ignores a questionnaire nobody finished', () => {
    const insights = analyseQuestions([
      response(null, [a('q1', BUDGET, 'Under €1,000', 'other')], { completedAt: null }),
    ]);

    expect(insights).toEqual([]);
  });

  /* One person can be sent away by two questions at once, so these numbers
     overlap by design and must never be added together. */
  it('counts a person once per question, not once in total', () => {
    const insights = analyseQuestions([
      response('other', [
        a('q1', BUDGET, 'Under €1,000', 'other'),
        a('q2', TIMING, 'Just exploring', 'other'),
      ]),
    ]);

    expect(insights.map((i) => i.sentElsewhere)).toEqual([1, 1]);
  });

  /* A business that rewords a question should see today's wording, not the
     version somebody answered in March. */
  it('uses the most recent wording of a question', () => {
    const [insight] = analyseQuestions([
      response('meeting', [a('q1', 'Old wording', 'Yes')]),
      response('meeting', [a('q1', 'New wording', 'Yes')]),
    ]);

    expect(insight!.prompt).toBe('New wording');
  });

  it('has nothing to say about no enquiries at all', () => {
    expect(analyseQuestions([])).toEqual([]);
  });

  it('lists a question nobody was filtered by, with zero', () => {
    const [insight] = analyseQuestions([response('meeting', [a('q1', BUDGET, '€5,000+')])]);
    expect(insight).toMatchObject({ answered: 1, sentElsewhere: 0, routingAnswers: [] });
  });
});

describe('analyseServices', () => {
  /* Started and completed fail differently: a service nobody finishes has a
     form problem, one everybody finishes but few qualify for has a rules
     problem. One combined number would hide which. */
  it('keeps started and completed apart', () => {
    const [insight] = analyseServices([
      response('meeting', []),
      response('other', []),
      response(null, [], { completedAt: null }),
    ]);

    expect(insight).toMatchObject({ started: 3, completed: 2, meeting: 1, other: 1 });
  });

  it('separates the services', () => {
    const insights = analyseServices([
      response('meeting', [], { eventTypeId: 'a' }),
      response('meeting', [], { eventTypeId: 'b' }),
      response('other', [], { eventTypeId: 'b' }),
    ]);

    expect(insights.map((i) => i.eventTypeId)).toEqual(['b', 'a']);
    expect(insights[0]).toMatchObject({ started: 2, meeting: 1, other: 1 });
  });

  /* A response can outlive the service it was for (on delete set null), and
     those enquiries still happened. */
  it('keeps enquiries whose service has since gone', () => {
    const insights = analyseServices([response('meeting', [], { eventTypeId: null })]);
    expect(insights).toHaveLength(1);
    expect(insights[0]!.eventTypeId).toBeNull();
  });

  it('has nothing to say about no enquiries at all', () => {
    expect(analyseServices([])).toEqual([]);
  });
});

describe('share', () => {
  it('reads as a whole percentage', () => {
    expect(share(1, 4)).toBe(25);
    expect(share(2, 3)).toBe(67);
    expect(share(3, 3)).toBe(100);
  });

  /* What a page would otherwise print in the first week of a business's
     life. */
  it('is zero rather than NaN when nothing has happened yet', () => {
    expect(share(0, 0)).toBe(0);
    expect(share(5, 0)).toBe(0);
  });
});

describe('telling a stranger from somebody you already know', () => {
  const known = knownSinceMap([
    { email: 'Maya@Example.com', created_at: '2026-01-10T09:00:00Z' },
    { email: 'sam@example.com', created_at: '2026-06-01T09:00:00Z' },
  ]);

  it('matches regardless of how the address was typed', () => {
    expect(alreadyKnown({ email: 'MAYA@example.com ', startedAt: '2026-08-01T00:00:00Z' }, known))
      .toBe(true);
  });

  it('counts somebody who was already a client when they answered', () => {
    expect(alreadyKnown({ email: 'maya@example.com', startedAt: '2026-08-01T00:00:00Z' }, known))
      .toBe(true);
  });

  it('does not count a first-time enquirer who became a client by booking', () => {
    /* The trap. Everybody who books gets a clients row, so by the time
       anybody reads this screen a successful first-time enquirer IS a
       client — and asking "are they a client?" would file every conversion
       under repeat business. The question is whether they were one before
       they started answering. */
    expect(alreadyKnown({ email: 'sam@example.com', startedAt: '2026-05-31T09:00:00Z' }, known))
      .toBe(false);
  });

  it('treats an unknown address as new', () => {
    expect(alreadyKnown({ email: 'nobody@example.com', startedAt: '2026-08-01T00:00:00Z' }, known))
      .toBe(false);
  });

  it('treats a response with no email yet as new, because that is what it is', () => {
    expect(alreadyKnown({ email: null, startedAt: '2026-08-01T00:00:00Z' }, known)).toBe(false);
  });

  it('keeps the earliest record when an address appears twice', () => {
    const twice = knownSinceMap([
      { email: 'a@b.c', created_at: '2026-05-01T00:00:00Z' },
      { email: 'a@b.c', created_at: '2026-01-01T00:00:00Z' },
    ]);
    expect(alreadyKnown({ email: 'a@b.c', startedAt: '2026-03-01T00:00:00Z' }, twice)).toBe(true);
  });
});
