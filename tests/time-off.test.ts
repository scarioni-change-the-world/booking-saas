import { describe, expect, it } from 'vitest';
import { closedRuns, datesBetween, runLabel, timeOffProblem } from '../src/lib/time-off';

describe('datesBetween', () => {
  it('includes both ends and crosses months and years', () => {
    expect(datesBetween('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(datesBetween('2026-10-03', '2026-10-03')).toEqual(['2026-10-03']);
  });

  it('is empty when the range is backwards or malformed', () => {
    expect(datesBetween('2026-10-05', '2026-10-03')).toEqual([]);
    expect(datesBetween('nope', '2026-10-03')).toEqual([]);
  });
});

describe('timeOffProblem', () => {
  const today = '2026-09-27';
  it('accepts a run from today on', () => {
    expect(timeOffProblem('2026-09-27', '2026-10-04', today)).toBeNull();
  });
  it('refuses the backwards, the past and the enormous', () => {
    expect(timeOffProblem('2026-10-04', '2026-10-01', today)).toMatch(/before the first/);
    expect(timeOffProblem('2026-09-20', '2026-09-30', today)).toMatch(/past/);
    expect(timeOffProblem('2026-10-01', '2027-10-01', today)).toMatch(/more than 120/);
    expect(timeOffProblem('', '2026-10-01', today)).toMatch(/Choose/);
  });
});

describe('closedRuns', () => {
  it('joins consecutive closed days and leaves own-hours days out', () => {
    expect(
      closedRuns([
        { date: '2026-12-26', isClosed: true, note: null },
        { date: '2026-12-24', isClosed: true, note: 'Christmas' },
        { date: '2026-12-25', isClosed: true, note: null },
        { date: '2026-12-28', isClosed: true, note: null },
        { date: '2026-12-27', isClosed: false, note: 'Short day' },
      ]),
    ).toEqual([
      { from: '2026-12-24', to: '2026-12-26', days: 3, note: 'Christmas' },
      { from: '2026-12-28', to: '2026-12-28', days: 1, note: null },
    ]);
  });
});

describe('runLabel', () => {
  it('reads as a person would say it', () => {
    expect(runLabel({ from: '2026-12-24', to: '2026-12-26' })).toBe('24–26 December');
    expect(runLabel({ from: '2026-10-30', to: '2026-11-02' })).toBe('30 October – 2 November');
    expect(runLabel({ from: '2026-12-30', to: '2027-01-02' })).toBe('30 December 2026 – 2 January 2027');
    expect(runLabel({ from: '2026-10-02', to: '2026-10-02' })).toBe('Friday 2 October');
  });
});
