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
    { label: 'Over 2.000 €', outcomePathType: 'meeting' },
    { label: '500 - 2.000 €', outcomePathType: 'meeting' },
    { label: "I can't afford this right now", outcomePathType: 'other' },
  ],
  required: true,
  sortOrder: 1,
};

const ready: Question = {
  id: 'q-ready',
  prompt: 'Are you ready to start this month?',
  kind: 'yes_no',
  options: [
    { label: 'Yes', outcomePathType: 'meeting' },
    { label: 'No', outcomePathType: 'meeting' },
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
  it('lands on the meeting path when every chosen option does', () => {
    const result = evaluateQualification([budget, ready], {
      'q-budget': 'Over 2.000 €',
      'q-ready': 'Yes',
    });
    expect(result.outcomePathType).toBe('meeting');
    expect(result.answers).toHaveLength(2);
  });

  it('sends the response down the other path on any single such option', () => {
    const result = evaluateQualification([budget, ready], {
      'q-budget': "I can't afford this right now",
      'q-ready': 'Yes',
    });
    expect(result.outcomePathType).toBe('other');
  });

  it('records the full answer set even when sent down the other path', () => {
    // The tenant still wants to see who was sent elsewhere and why.
    const result = evaluateQualification([budget, ready], {
      'q-budget': "I can't afford this right now",
      'q-ready': 'No',
    });
    expect(result.answers.map((a) => a.answer)).toEqual([
      "I can't afford this right now",
      'No',
    ]);
    expect(result.answers[0]!.outcomePathType).toBe('other');
    expect(result.answers[1]!.outcomePathType).toBe('meeting');
  });

  it('treats yes/no as an ordinary option pair, not an implicit gate', () => {
    // "No" only sends someone down the other path if the tenant set it up that way.
    expect(evaluateQualification([ready], { 'q-ready': 'No' }).outcomePathType).toBe('meeting');

    const gating: Question = {
      ...ready,
      options: [
        { label: 'Yes', outcomePathType: 'meeting' },
        { label: 'No', outcomePathType: 'other' },
      ],
    };
    expect(evaluateQualification([gating], { 'q-ready': 'No' }).outcomePathType).toBe('other');
  });

  it('never sends anyone off the meeting path on free text alone', () => {
    const result = evaluateQualification([goal], { 'q-goal': 'no budget at all' });
    expect(result.outcomePathType).toBe('meeting');
    expect(result.answers[0]!.outcomePathType).toBeNull();
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
    expect(result.outcomePathType).toBe('meeting');
    expect(result.answers).toHaveLength(1);
  });

  it('rejects a missing required answer', () => {
    expect(() => evaluateQualification([budget], {})).toThrow(QualificationError);
    expect(() => evaluateQualification([budget], { 'q-budget': '   ' })).toThrow(
      QualificationError,
    );
  });

  it('rejects an option the question does not offer', () => {
    // A tampered submission must not be silently scored onto the meeting path.
    expect(() =>
      evaluateQualification([budget], { 'q-budget': 'Over 9.000 €' }),
    ).toThrow(QualificationError);
  });
});

describe('toPublicQuestions', () => {
  it('does not leak which options lead to which path', () => {
    const serialised = JSON.stringify(toPublicQuestions([budget, ready]));
    expect(serialised).not.toContain('outcomePathType');
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
