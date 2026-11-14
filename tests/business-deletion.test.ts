import { describe, expect, it } from 'vitest';
import {
  businessDeletionBlockers,
  businessDeletionSteps,
  slugConfirmed,
  type BusinessDeletionFacts,
} from '../src/lib/business-deletion';

const base: BusinessDeletionFacts = {
  name: 'Mara Studio',
  slug: 'mara',
  status: 'suspended',
  upcoming: 0,
  upcomingPaid: 0,
  lastUpcomingAt: null,
  owedSessions: 0,
  owedClients: 0,
  clients: 12,
  pastAppointments: 40,
  services: 3,
  loginsDeleted: 1,
  loginsKept: 0,
  calendarConnected: false,
  subscription: false,
};

describe('who may delete a business, and when', () => {
  it('lets a console owner delete a suspended business that owes nothing', () => {
    expect(businessDeletionBlockers(base, 'owner')).toEqual([]);
  });

  it('refuses anyone but a console owner', () => {
    expect(businessDeletionBlockers(base, 'admin')).toEqual(['Only a console owner can delete a business.']);
    expect(businessDeletionBlockers(base, 'support')).toHaveLength(1);
  });

  it('asks for it to be suspended first', () => {
    expect(businessDeletionBlockers({ ...base, status: 'active' }, 'owner')[0]).toMatch(/Suspend it first/);
  });

  it('will not delete sessions clients have paid for and not booked', () => {
    const [reason] = businessDeletionBlockers({ ...base, owedSessions: 3, owedClients: 2 }, 'owner');
    expect(reason).toMatch(/2 clients still have 3 paid sessions to book/);
  });

  it('does not block on appointments still to come: they are cancelled, with an email', () => {
    expect(businessDeletionBlockers({ ...base, upcoming: 4 }, 'owner')).toEqual([]);
  });
});

describe('what deleting will do', () => {
  it('says each thing that happens, in order, ending with the freed address', () => {
    const steps = businessDeletionSteps(
      {
        ...base,
        upcoming: 2,
        upcomingPaid: 1,
        lastUpcomingAt: '2026-12-03T10:00:00Z',
        loginsDeleted: 1,
        loginsKept: 1,
        calendarConnected: true,
        subscription: true,
      },
      'Europe/Madrid',
    );
    expect(steps[0]).toBe(
      '2 appointments still to come are cancelled (the last on 3 December), and each client gets the business’s cancellation email. 1 paid online is refunded.',
    );
    expect(steps[1]).toBe(
      'All its data is deleted: 12 clients, 40 past appointments, 3 services, questions, messages, reports and logo.',
    );
    expect(steps[2]).toMatch(/1 team login is deleted, so that address can sign up again\. 1 login stays/);
    expect(steps).toContain('Its calendar is disconnected.');
    expect(steps).toContain('Its khloe subscription is cancelled, with no further charges.');
    expect(steps.at(-1)).toBe('Its address, /mara, is free for anyone to take.');
  });

  it('leaves out what does not apply', () => {
    const steps = businessDeletionSteps(base);
    expect(steps).toHaveLength(3);
    expect(steps.join(' ')).not.toMatch(/cancelled|calendar|subscription/);
  });
});

describe('typing the address back', () => {
  it('forgives case, spaces and a leading slash, nothing else', () => {
    expect(slugConfirmed(' /Mara ', 'mara')).toBe(true);
    expect(slugConfirmed('mara-studio', 'mara')).toBe(false);
    expect(slugConfirmed('', 'mara')).toBe(false);
  });
});
