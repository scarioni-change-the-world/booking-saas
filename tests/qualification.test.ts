import { describe, expect, it } from 'vitest';
import {
  QualificationError,
  evaluateQualification,
  toPublicQuestions,
  type Question,
} from '@/lib/qualification';

const budget: Question = {
  id: 'q-budget',
  prompt: 'What can you invest right now?',
  kind: 'single_choice',
  options: [
    { label: 'Over 2.000 €', qualifies: true },
    { label: '500 - 2.000 €', qualifies: true },
    { label: "I can't afford this right now", qualifies: false },
  ],
  required: true,
  sortOrder: 1,
};

const ready: Question = {
  id: 'q-ready',
  prompt: 'Are you ready to start this month?',
  kind: 'yes_no',
  options: [
    { label: 'Yes', qualifies: true },
    { label: 'No', qualifies: true },
  ],
  required: true,
  sortOrder: 2,
};

const goal: Question = {
  id: 'q-goal',
  prompt: 'What would you like to work on?',
  kind: 'text',
  options: [],
  required: false,
  sortOrder: 3,
};

describe('evaluateQualification', () => {
  it('qualifies when every chosen option qualifies', () => {
    const result = evaluateQualification([budget, ready], {
      'q-budget': 'Over 2.000 €',
      'q-ready': 'Yes',
    });
    expect(result.outcome).toBe('qualified');
    expect(result.answers).toHaveLength(2);
  });

  it('redirects on any single disqualifying option', () => {
    const result = evaluateQualification([budget, ready], {
      'q-budget': "I can't afford this right now",
      'q-ready': 'Yes',
    });
    expect(result.outcome).toBe('redirected');
  });

  it('records the full answer set even when redirected', () => {
    // The tenant still wants to see who was screened out and why.
    const result = evaluateQualification([budget, ready], {
      'q-budget': "I can't afford this right now",
      'q-ready': 'No',
    });
    expect(result.answers.map((a) => a.answer)).toEqual([
      "I can't afford this right now",
      'No',
    ]);
    expect(result.answers[0]!.qualifies).toBe(false);
    expect(result.answers[1]!.qualifies).toBe(true);
  });

  it('treats yes/no as an ordinary option pair, not an implicit gate', () => {
    // "No" only disqualifies if the tenant flagged that option as such.
    expect(evaluateQualification([ready], { 'q-ready': 'No' }).outcome).toBe('qualified');

    const gating: Question = {
      ...ready,
      options: [
        { label: 'Yes', qualifies: true },
        { label: 'No', qualifies: false },
      ],
    };
    expect(evaluateQualification([gating], { 'q-ready': 'No' }).outcome).toBe('redirected');
  });

  it('never disqualifies on free text', () => {
    const result = evaluateQualification([goal], { 'q-goal': 'no budget at all' });
    expect(result.outcome).toBe('qualified');
    expect(result.answers[0]!.qualifies).toBeNull();
  });

  it('scores answers in the tenant-defined order regardless of input order', () => {
    const result = evaluateQualification([goal, ready, budget], {
      'q-ready': 'Yes',
      'q-goal': 'Confidence',
      'q-budget': 'Over 2.000 €',
    });
    expect(result.answers.map((a) => a.questionId)).toEqual(['q-budget', 'q-ready', 'q-goal']);
  });

  it('skips an unanswered optional question', () => {
    const result = evaluateQualification([budget, goal], { 'q-budget': 'Over 2.000 €' });
    expect(result.outcome).toBe('qualified');
    expect(result.answers).toHaveLength(1);
  });

  it('rejects a missing required answer', () => {
    expect(() => evaluateQualification([budget], {})).toThrow(QualificationError);
    expect(() => evaluateQualification([budget], { 'q-budget': '   ' })).toThrow(
      QualificationError,
    );
  });

  it('rejects an option the question does not offer', () => {
    // A tampered submission must not be silently scored as qualified.
    expect(() =>
      evaluateQualification([budget], { 'q-budget': 'Over 9.000 €' }),
    ).toThrow(QualificationError);
  });
});

describe('toPublicQuestions', () => {
  it('does not leak which options qualify', () => {
    const serialised = JSON.stringify(toPublicQuestions([budget, ready]));
    expect(serialised).not.toContain('qualifies');
    expect(serialised).toContain("I can't afford this right now");
  });

  it('sorts by the tenant-defined order', () => {
    expect(toPublicQuestions([goal, budget, ready]).map((q) => q.id)).toEqual([
      'q-budget',
      'q-ready',
      'q-goal',
    ]);
  });
});
