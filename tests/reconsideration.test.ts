import { describe, expect, it } from 'vitest';
import {
  describeGap,
  findReconsideration,
  type Attempt,
  type AnswerSnapshot,
} from '@/lib/reconsideration';

const answer = (
  questionId: string,
  prompt: string,
  value: string,
  outcomePathType: 'meeting' | 'other' | null = 'meeting',
): AnswerSnapshot => ({ questionId, prompt, answer: value, outcomePathType });

const attempt = (
  id: string,
  completedAt: string | null,
  outcome: 'meeting' | 'other' | null,
  answers: AnswerSnapshot[],
  overrides: Partial<Attempt> = {},
): Attempt => ({
  id,
  email: 'jordan@example.com',
  eventTypeId: 'service-1',
  completedAt,
  outcomePathType: outcome,
  answers,
  ...overrides,
});

const BUDGET = 'What is your budget?';

describe('findReconsideration', () => {
  /* The pattern this exists for: turned away, answered again, got in. */
  it('finds somebody who answered again after being sent elsewhere', () => {
    const first = attempt('1', '2026-03-01T10:00:00.000Z', 'other', [
      answer('q1', BUDGET, 'Under €1,000', 'other'),
    ]);
    const second = attempt('2', '2026-03-01T10:04:00.000Z', 'meeting', [
      answer('q1', BUDGET, '€2,000–5,000'),
    ]);

    const found = findReconsideration(second, [first, second]);

    expect(found).not.toBeNull();
    expect(found!.minutesBetween).toBe(4);
    expect(found!.earlierAttempts).toBe(1);
    expect(found!.changed).toEqual([
      { prompt: BUDGET, before: 'Under €1,000', after: '€2,000–5,000', decisive: true },
    ]);
  });

  /* Tried again, same answer. Nothing was talked around. */
  it('says nothing when the second attempt was turned away too', () => {
    const first = attempt('1', '2026-03-01T10:00:00.000Z', 'other', []);
    const second = attempt('2', '2026-03-01T10:04:00.000Z', 'other', []);

    expect(findReconsideration(second, [first, second])).toBeNull();
  });

  it('says nothing about a plain restart that was always going to qualify', () => {
    const first = attempt('1', '2026-03-01T10:00:00.000Z', 'meeting', []);
    const second = attempt('2', '2026-03-01T10:04:00.000Z', 'meeting', []);

    expect(findReconsideration(second, [first, second])).toBeNull();
  });

  /* They made their own case worse. Nobody's idea of gaming the gate. */
  it('says nothing when someone qualified first and was turned away after', () => {
    const first = attempt('1', '2026-03-01T10:00:00.000Z', 'meeting', []);
    const second = attempt('2', '2026-03-01T10:04:00.000Z', 'other', []);

    expect(findReconsideration(second, [first, second])).toBeNull();
  });

  it('says nothing about a first attempt with no history', () => {
    const only = attempt('1', '2026-03-01T10:00:00.000Z', 'meeting', []);
    expect(findReconsideration(only, [only])).toBeNull();
  });

  it('ignores an attempt that was never finished', () => {
    const abandoned = attempt('1', null, null, []);
    const second = attempt('2', '2026-03-01T10:04:00.000Z', 'meeting', []);

    expect(findReconsideration(second, [abandoned, second])).toBeNull();
  });

  /* A different person entirely. */
  it('does not join up two different people', () => {
    const other = attempt('1', '2026-03-01T10:00:00.000Z', 'other', [], {
      email: 'marta@example.com',
    });
    const mine = attempt('2', '2026-03-01T10:04:00.000Z', 'meeting', []);

    expect(findReconsideration(mine, [other, mine])).toBeNull();
  });

  it('matches an address whatever case it was typed in', () => {
    const first = attempt('1', '2026-03-01T10:00:00.000Z', 'other', [], {
      email: 'Jordan@Example.com',
    });
    const second = attempt('2', '2026-03-01T10:04:00.000Z', 'meeting', []);

    expect(findReconsideration(second, [first, second])).not.toBeNull();
  });

  /* A different service asks different questions, so the two attempts are
     not answers to the same thing. */
  it('does not join up attempts at two different services', () => {
    const first = attempt('1', '2026-03-01T10:00:00.000Z', 'other', [], {
      eventTypeId: 'service-2',
    });
    const second = attempt('2', '2026-03-01T10:04:00.000Z', 'meeting', []);

    expect(findReconsideration(second, [first, second])).toBeNull();
  });

  /* With no address there is nobody to join up — an anonymous second
     attempt is indistinguishable from a different person entirely. */
  it('says nothing when there is no address to match on', () => {
    const first = attempt('1', '2026-03-01T10:00:00.000Z', 'other', [], { email: null });
    const second = attempt('2', '2026-03-01T10:04:00.000Z', 'meeting', [], { email: null });

    expect(findReconsideration(second, [first, second])).toBeNull();
  });

  /* What changed since the most recent refusal is what a business is
     looking at, not what changed since the first. */
  it('compares against the last closed door, not the first', () => {
    const first = attempt('1', '2026-03-01T10:00:00.000Z', 'other', [
      answer('q1', BUDGET, 'Under €500', 'other'),
    ]);
    const second = attempt('2', '2026-03-01T10:02:00.000Z', 'other', [
      answer('q1', BUDGET, 'Under €1,000', 'other'),
    ]);
    const third = attempt('3', '2026-03-01T10:05:00.000Z', 'meeting', [
      answer('q1', BUDGET, '€2,000–5,000'),
    ]);

    const found = findReconsideration(third, [first, second, third]);

    expect(found!.changed[0]!.before).toBe('Under €1,000');
    expect(found!.earlierAttempts).toBe(2);
  });

  it('puts the answer that closed the door first', () => {
    const first = attempt('1', '2026-03-01T10:00:00.000Z', 'other', [
      answer('q1', 'Your phone number?', '600 111 222'),
      answer('q2', BUDGET, 'Under €1,000', 'other'),
    ]);
    const second = attempt('2', '2026-03-01T10:04:00.000Z', 'meeting', [
      answer('q1', 'Your phone number?', '600 999 888'),
      answer('q2', BUDGET, '€2,000–5,000'),
    ]);

    const found = findReconsideration(second, [first, second]);

    expect(found!.changed.map((c) => c.decisive)).toEqual([true, false]);
    expect(found!.changed[0]!.prompt).toBe(BUDGET);
  });

  /* A business that adds a question between two attempts must not make
     every answer look as though it moved. */
  it('matches answers by question, not by position', () => {
    const first = attempt('1', '2026-03-01T10:00:00.000Z', 'other', [
      answer('q2', BUDGET, 'Under €1,000', 'other'),
    ]);
    const second = attempt('2', '2026-03-01T10:04:00.000Z', 'meeting', [
      answer('q9', 'How did you hear about us?', 'A friend'),
      answer('q2', BUDGET, '€2,000–5,000'),
    ]);

    const found = findReconsideration(second, [first, second]);

    // The new question was not answered differently; it was not asked before.
    expect(found!.changed).toHaveLength(1);
    expect(found!.changed[0]!.prompt).toBe(BUDGET);
  });

  /* The same answers getting a different outcome means the business's own
     rules moved underneath them. Still worth surfacing, with nothing
     highlighted — because nobody changed anything. */
  it('reports a reconsideration with no changes when the rules moved instead', () => {
    const first = attempt('1', '2026-03-01T10:00:00.000Z', 'other', [
      answer('q1', BUDGET, 'Under €1,000', 'other'),
    ]);
    const second = attempt('2', '2026-04-01T10:00:00.000Z', 'meeting', [
      answer('q1', BUDGET, 'Under €1,000'),
    ]);

    const found = findReconsideration(second, [first, second]);

    expect(found).not.toBeNull();
    expect(found!.changed).toEqual([]);
  });

  it('ignores trailing whitespace rather than calling it a change', () => {
    const first = attempt('1', '2026-03-01T10:00:00.000Z', 'other', [
      answer('q1', BUDGET, 'Under €1,000', 'other'),
      answer('q2', 'Anything else?', 'No  '),
    ]);
    const second = attempt('2', '2026-03-01T10:04:00.000Z', 'meeting', [
      answer('q1', BUDGET, '€2,000–5,000'),
      answer('q2', 'Anything else?', 'No'),
    ]);

    expect(findReconsideration(second, [first, second])!.changed).toHaveLength(1);
  });
});

describe('describeGap', () => {
  /* The two readings that matter are "four minutes later" and "three weeks
     later". Everything between just has to land on the right side. */
  it('reads naturally at every scale', () => {
    expect(describeGap(0)).toBe('a minute later');
    expect(describeGap(1)).toBe('a minute later');
    expect(describeGap(4)).toBe('4 minutes later');
    expect(describeGap(59)).toBe('59 minutes later');
    expect(describeGap(60)).toBe('an hour later');
    expect(describeGap(180)).toBe('3 hours later');
    expect(describeGap(60 * 24)).toBe('the next day');
    expect(describeGap(60 * 24 * 3)).toBe('3 days later');
    expect(describeGap(60 * 24 * 7)).toBe('a week later');
    expect(describeGap(60 * 24 * 21)).toBe('3 weeks later');
    expect(describeGap(60 * 24 * 60)).toBe('2 months later');
  });

  it('never says "0 minutes later"', () => {
    for (const minutes of [0, 1, 2]) {
      expect(describeGap(minutes)).not.toContain('0 minutes');
    }
  });
});
