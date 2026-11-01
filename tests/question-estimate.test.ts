import { describe, expect, it } from 'vitest';
import { questionsEstimate, questionsLede } from '@/lib/question-estimate';

const q = (kind: 'text' | 'yes_no' | 'single_choice') => ({ kind });

describe('questionsEstimate', () => {
  it('says nothing when there are no questions', () => {
    expect(questionsEstimate([])).toBeNull();
  });

  it('uses the singular for one question', () => {
    expect(questionsEstimate([q('yes_no')])).toBe('1 quick question · under a minute');
  });

  it('counts three quick choices as under a minute', () => {
    expect(questionsEstimate([q('yes_no'), q('single_choice'), q('single_choice')])).toBe(
      '3 quick questions · under a minute',
    );
  });

  it('gives written answers more time', () => {
    expect(questionsEstimate([q('text'), q('text'), q('single_choice')])).toBe('3 quick questions · about a minute');
  });

  it('stops calling ten questions "quick" and counts minutes', () => {
    const ten = [...Array(5)].map(() => q('text')).concat([...Array(5)].map(() => q('single_choice')));
    expect(questionsEstimate(ten)).toBe('10 questions · about 4 minutes');
  });
});

describe('questionsLede', () => {
  it('matches the number of questions', () => {
    expect(questionsLede(1, 'Mara')).toMatch(/^One short question/);
    expect(questionsLede(4, 'Mara')).toMatch(/^A few short questions/);
    expect(questionsLede(10, 'Mara')).toMatch(/^Some questions/);
  });
});
