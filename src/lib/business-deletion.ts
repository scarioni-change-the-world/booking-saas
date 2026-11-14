import { DateTime } from 'luxon';

/**
 * The rules for deleting a whole business from the owner console, in the
 * same shape as deleting a service (service-deletion.ts): first what
 * stops it, then what will happen, then its web address typed back.
 *
 *   - Only a console owner may do it.
 *   - The business must be suspended first: suspending is the reversible
 *     step (the page stops, the team is locked out), deleting is the final
 *     one, and keeping them apart makes it hard to do by accident.
 *   - Sessions a client has paid for and not booked block it, as they do a
 *     service: nobody would give that money back once the business is gone.
 *   - Appointments still to come do not block it. Each is cancelled with
 *     the business's own cancellation email, refunded if it was paid online.
 *
 * Then everything goes: clients, appointments, services, questions,
 * messages, reports, logo, calendar connection, the khloe subscription,
 * and the logins of the people on its team who belong to no other
 * business. Its web address is free again at once.
 *
 * Pure and client-safe: the console panel and the route read the same rules.
 */

export interface BusinessDeletionFacts {
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'deleted';
  /** Confirmed appointments still to come, and how many of them were paid online. */
  upcoming: number;
  upcomingPaid: number;
  lastUpcomingAt: string | null;
  /** Sessions paid for and not booked yet, and how many people hold them. */
  owedSessions: number;
  owedClients: number;
  clients: number;
  pastAppointments: number;
  services: number;
  /** Logins deleted with it (on no other business), and logins kept (on another one). */
  loginsDeleted: number;
  loginsKept: number;
  calendarConnected: boolean;
  subscription: boolean;
  /** Migration 0037 (the delete_tenant function) is in the database. Checked
   *  before anything is touched, so a missing migration stops it at the
   *  start, not after appointments were already cancelled. */
  databaseReady: boolean;
}

/** Why it cannot be deleted yet, each with what clears it. Empty when it can. */
export function businessDeletionBlockers(facts: BusinessDeletionFacts, staffRole: string): string[] {
  const reasons: string[] = [];
  if (!facts.databaseReady) {
    reasons.push('The database is missing migration 0037 (delete_business). Run it in Supabase, then try again.');
  }
  if (staffRole !== 'owner') reasons.push('Only a console owner can delete a business.');
  if (facts.status === 'active') {
    reasons.push('It is still active. Suspend it first: that stops its page and locks its team out, and can be undone.');
  }
  if (facts.owedSessions > 0) {
    const sessions = facts.owedSessions === 1 ? '1 paid session' : `${facts.owedSessions} paid sessions`;
    const who = facts.owedClients === 1 ? '1 client' : `${facts.owedClients} clients`;
    reasons.push(
      `${who} still ${facts.owedClients === 1 ? 'has' : 'have'} ${sessions} to book. Settle them with the business first: nobody could refund them afterwards.`,
    );
  }
  return reasons;
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What deleting will do, line by line, said before anything is typed. */
export function businessDeletionSteps(facts: BusinessDeletionFacts, timezone = 'UTC'): string[] {
  const steps: string[] = [];
  if (facts.upcoming > 0) {
    const last = facts.lastUpcomingAt
      ? ` (the last on ${DateTime.fromISO(facts.lastUpcomingAt).setZone(timezone).toFormat('d LLLL')})`
      : '';
    const paid = facts.upcomingPaid > 0 ? ` ${n(facts.upcomingPaid, 'paid online is', 'paid online are')} refunded.` : '';
    steps.push(
      `${n(facts.upcoming, 'appointment still to come is', 'appointments still to come are')} cancelled${last}, and each client gets the business’s cancellation email.${paid}`,
    );
  }
  steps.push(
    `All its data is deleted: ${n(facts.clients, 'client', 'clients')}, ${n(facts.pastAppointments, 'past appointment', 'past appointments')}, ${n(facts.services, 'service', 'services')}, questions, messages, reports and logo.`,
  );
  if (facts.loginsDeleted > 0 || facts.loginsKept > 0) {
    const kept = facts.loginsKept > 0 ? ` ${n(facts.loginsKept, 'login stays', 'logins stay')}, because it is on another business too.` : '';
    steps.push(
      facts.loginsDeleted > 0
        ? `${n(facts.loginsDeleted, 'team login is', 'team logins are')} deleted, so ${facts.loginsDeleted === 1 ? 'that address' : 'those addresses'} can sign up again.${kept}`
        : kept.trim(),
    );
  }
  if (facts.calendarConnected) steps.push('Its calendar is disconnected.');
  if (facts.subscription) steps.push('Its khloe subscription is cancelled, with no further charges.');
  steps.push(`Its address, /${facts.slug}, is free for anyone to take.`);
  return steps;
}

/** Whether what was typed is the business's web address. Case, spaces and a leading slash are forgiven. */
export function slugConfirmed(typed: string, slug: string): boolean {
  const norm = (s: string) => s.trim().replace(/^\/+/, '').toLowerCase();
  return norm(typed) !== '' && norm(typed) === norm(slug);
}

/** The reason each cancelled appointment carries, in the client's cancellation email. */
export const CLOSING_REASON = 'This appointment was cancelled because online booking with this business has closed.';
