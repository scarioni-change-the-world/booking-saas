import { describe, expect, it } from 'vitest';
import {
  deletionBlockers,
  deletionKeeps,
  nameConfirmed,
  withinServiceLimit,
  type DeletionFacts,
} from '@/lib/service-deletion';

const empty: DeletionFacts = {
  name: 'Discovery call',
  active: false,
  upcoming: 0,
  lastUpcomingAt: null,
  owedSessions: 0,
  owedClients: 0,
  past: 0,
};

describe('deletionBlockers', () => {
  it('lets a paused, empty service go', () => {
    expect(deletionBlockers(empty, 'Europe/Madrid')).toEqual([]);
  });

  it('asks for a pause first', () => {
    expect(deletionBlockers({ ...empty, active: true }, 'Europe/Madrid')).toEqual([
      'It is still taking appointments. Pause it first.',
    ]);
  });

  it('says how many appointments are still coming, the last one, and what clears them', () => {
    expect(
      deletionBlockers({ ...empty, upcoming: 2, lastUpcomingAt: '2026-10-14T08:00:00Z' }, 'Europe/Madrid'),
    ).toEqual(['2 appointments are still coming up, the last on 14 October. They clear when they take place, or when they are cancelled.']);
  });

  it('refuses while somebody still has paid sessions to book', () => {
    expect(deletionBlockers({ ...empty, owedSessions: 3, owedClients: 1 }, 'Europe/Madrid')).toEqual([
      '1 person still has 3 paid sessions to book.',
    ]);
  });
});

describe('deletionKeeps', () => {
  it('says the past stays, and that clients keep their history', () => {
    expect(deletionKeeps({ ...empty, past: 12 })).toBe(
      '12 past appointments stay in your history under its name, and those clients keep their history with you.',
    );
    expect(deletionKeeps(empty)).toBe('It has never been booked, so nothing else changes.');
  });
});

describe('nameConfirmed', () => {
  it('forgives spacing and case, not the words', () => {
    expect(nameConfirmed('  discovery   CALL ', 'Discovery call')).toBe(true);
    expect(nameConfirmed('Discovery', 'Discovery call')).toBe(false);
    expect(nameConfirmed('   ', '')).toBe(false);
  });
});

describe('withinServiceLimit', () => {
  it('allows up to five active services', () => {
    expect(withinServiceLimit(4)).toBe(true);
    expect(withinServiceLimit(5)).toBe(false);
  });
});
