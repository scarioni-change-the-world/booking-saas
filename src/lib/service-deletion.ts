import { DateTime } from 'luxon';

/**
 * The rules for pausing, resuming and deleting a service.
 *
 * Pausing ("archiving" in the code: active = false) means no new
 * appointments can be made. It is allowed at any time: whoever already
 * booked keeps their appointment and can still move or cancel it, and a
 * client with sessions paid for can still book them. It is what somebody
 * retiring a service wants at once.
 *
 * Deleting is for good. Only a paused service that is empty can be deleted:
 * nothing still coming up, and no sessions somebody has paid for and not yet
 * booked. The deletion never cancels anyone; the appointments clear when
 * they take place or when they are cancelled, one person at a time. Past
 * appointments are kept under the service's name (migration 0029), so no
 * client loses their history or their standing.
 *
 * Pure and client-safe: the route that deletes and the panel that asks both
 * read these, so what the panel promises is what the route enforces.
 */

/** Active services a business can have at once. Paused ones do not count. */
export const SERVICE_LIMIT = 5;

export function withinServiceLimit(activeCount: number): boolean {
  return activeCount < SERVICE_LIMIT;
}

export const LIMIT_REACHED = `You’re using all ${SERVICE_LIMIT} services available right now. Pause one to make room for another.`;

export interface DeletionFacts {
  name: string;
  /** Still taking new appointments. */
  active: boolean;
  /** Confirmed appointments still to come. */
  upcoming: number;
  lastUpcomingAt: string | null;
  /** Sessions paid for and not yet booked, and how many people hold them. */
  owedSessions: number;
  owedClients: number;
  /** Appointments already past, which are kept. */
  past: number;
}

/**
 * Why this service cannot be deleted yet, in words, with what clears each
 * reason. Empty when it can.
 */
export function deletionBlockers(facts: DeletionFacts, timezone: string): string[] {
  const reasons: string[] = [];
  if (facts.active) {
    reasons.push('It is still taking appointments. Pause it first.');
  }
  if (facts.upcoming > 0) {
    const last = facts.lastUpcomingAt
      ? DateTime.fromISO(facts.lastUpcomingAt).setZone(timezone).toFormat('d LLLL')
      : null;
    const count = facts.upcoming === 1 ? '1 appointment is' : `${facts.upcoming} appointments are`;
    reasons.push(
      `${count} still coming up${last ? `, the last on ${last}` : ''}. They clear when they take place, or when they are cancelled.`,
    );
  }
  if (facts.owedSessions > 0) {
    const sessions = facts.owedSessions === 1 ? '1 paid session' : `${facts.owedSessions} paid sessions`;
    const who = facts.owedClients === 1 ? '1 person' : `${facts.owedClients} people`;
    reasons.push(`${who} still ${facts.owedClients === 1 ? 'has' : 'have'} ${sessions} to book.`);
  }
  return reasons;
}

/** What deleting keeps, said before anything is typed. */
export function deletionKeeps(facts: DeletionFacts): string {
  if (facts.past === 0) return 'It has never been booked, so nothing else changes.';
  const count = facts.past === 1 ? '1 past appointment stays' : `${facts.past} past appointments stay`;
  return `${count} in your history under its name, and those clients keep their history with you.`;
}

/**
 * Whether what somebody typed is the service's name. Spacing and letter
 * case are forgiven; the words are not.
 */
export function nameConfirmed(typed: string, name: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return norm(typed) !== '' && norm(typed) === norm(name);
}
