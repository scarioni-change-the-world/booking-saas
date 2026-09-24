/**
 * What a client sees of their own history: a thread, not a receipt.
 *
 * Someone halfway through a programme used to see one appointment — the one
 * their link was for — with a count underneath. The whole programme, with
 * the session they cancelled drawn as missing and the way to book it on
 * that spot, is what tells them where they are. Their own link gets the
 * same longer view: everything they have done with the business, what is
 * next, and what they are still owed.
 *
 * Pure and client-safe; dates are formatted by the page, in the viewer's
 * own zone, the way the rest of the client's pages do.
 */

export interface ThreadAppointment {
  startsAt: string;
  endsAt: string;
  status: 'confirmed' | 'cancelled';
}

export type ThreadTone = 'done' | 'next' | 'booked' | 'owed';

export interface ProgrammeStep {
  tone: ThreadTone;
  /** For a held appointment; absent on a spot still to book. */
  startsAt?: string;
  /** Which session of the programme this is, from 1. */
  position: number;
  /** For an owed spot left by a cancellation: when the cancelled one was. */
  cancelledStartsAt?: string;
}

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

/** "Third session", or "Session 12" past the tenth. */
export function sessionName(position: number): string {
  return position <= ORDINALS.length ? `${ORDINALS[position - 1]} session` : `Session ${position}`;
}

/**
 * A programme as a thread: every held appointment in time order, then a
 * spot for each session still owed.
 *
 * The held ones are done, next, or booked. A cancelled appointment is not
 * drawn as itself — the programme did not shrink, it has a gap — so it
 * becomes an owed spot, saying when the cancelled one was. Cancellations
 * already replaced by a later booking leave no trace here; the business
 * still has that history, the client does not need it.
 *
 * `remaining` is the programme's own answer to "how many are owed" (see
 * packStanding), which can exceed the cancellations when the business has
 * added sessions; the extra ones are spots with nothing to explain.
 */
export function programmeThread(
  appointments: readonly ThreadAppointment[],
  remaining: number,
  nowIso: string,
): ProgrammeStep[] {
  const sorted = [...appointments].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const held = sorted.filter((a) => a.status === 'confirmed');
  const cancelled = sorted.filter((a) => a.status === 'cancelled');

  const steps: ProgrammeStep[] = [];
  let nextFound = false;
  held.forEach((a, i) => {
    let tone: ThreadTone;
    if (a.endsAt <= nowIso) tone = 'done';
    else if (!nextFound) {
      tone = 'next';
      nextFound = true;
    } else tone = 'booked';
    steps.push({ tone, startsAt: a.startsAt, position: i + 1 });
  });

  /* The most recent cancellations are the ones still waiting to be
     replaced: anything older was booked again already. */
  const unreplaced = cancelled.slice(Math.max(0, cancelled.length - remaining));
  for (let k = 0; k < remaining; k++) {
    steps.push({
      tone: 'owed',
      position: held.length + k + 1,
      cancelledStartsAt: unreplaced[k]?.startsAt,
    });
  }
  return steps;
}

/* ── The private link: everything with this business ───────────────────── */

export interface HistoryBooking {
  startsAt: string;
  endsAt: string;
  status: 'confirmed' | 'cancelled';
  eventTypeName: string;
  packId: string | null;
  packSize: number | null;
  /** Only for appointments still to come, so they can be changed. */
  manageToken: string | null;
}

export interface Owed {
  entitlementId: string;
  eventTypeName: string;
  remaining: number;
  totalSessions: number;
}

export type ClientStep =
  | { kind: 'single'; tone: 'done' | 'next' | 'booked'; eventTypeName: string; startsAt: string; manageToken: string | null }
  | {
      kind: 'programme';
      tone: 'done' | 'next' | 'booked';
      eventTypeName: string;
      size: number;
      done: number;
      /** The programme's next appointment, if one is coming up. */
      next: { startsAt: string; manageToken: string | null } | null;
      startsAt: string;
    }
  | { kind: 'owed'; tone: 'owed'; owed: Owed };

/**
 * A client's whole history with the business, oldest first, ending on
 * whatever they are still owed. A programme is one step, not ten; the
 * manage page is where its sessions are drawn one by one.
 *
 * Cancelled single appointments are left out: they did not happen, and a
 * client reading their own history does not need to be reminded of every
 * change of plan.
 */
export function clientThread(
  history: readonly HistoryBooking[],
  owed: readonly Owed[],
  nowIso: string,
): ClientStep[] {
  const steps: ClientStep[] = [];
  const packs = new Map<string, HistoryBooking[]>();
  for (const b of history) {
    if (!b.packId) continue;
    const list = packs.get(b.packId) ?? [];
    list.push(b);
    packs.set(b.packId, list);
  }

  const drawn = new Set<string>();
  const sorted = [...history].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const b of sorted) {
    if (b.packId) {
      if (drawn.has(b.packId)) continue;
      drawn.add(b.packId);
      const list = packs.get(b.packId)!.filter((x) => x.status === 'confirmed');
      if (list.length === 0) continue;
      const done = list.filter((x) => x.endsAt <= nowIso).length;
      const upcoming = list.filter((x) => x.endsAt > nowIso).sort((x, y) => x.startsAt.localeCompare(y.startsAt));
      steps.push({
        kind: 'programme',
        tone: upcoming.length === 0 ? 'done' : 'booked',
        eventTypeName: b.eventTypeName,
        size: b.packSize ?? list.length,
        done,
        next: upcoming[0] ? { startsAt: upcoming[0].startsAt, manageToken: upcoming[0].manageToken } : null,
        startsAt: list[0]!.startsAt,
      });
      continue;
    }
    if (b.status !== 'confirmed') continue;
    steps.push({
      kind: 'single',
      tone: b.endsAt <= nowIso ? 'done' : 'booked',
      eventTypeName: b.eventTypeName,
      startsAt: b.startsAt,
      manageToken: b.manageToken,
    });
  }

  /* One "next": the soonest thing still to come, whichever step holds it. */
  let soonest: { index: number; at: string } | null = null;
  steps.forEach((s, i) => {
    const at = s.kind === 'single' && s.tone === 'booked' ? s.startsAt : s.kind === 'programme' ? s.next?.startsAt : undefined;
    if (at && (!soonest || at < soonest.at)) soonest = { index: i, at };
  });
  if (soonest) steps[(soonest as { index: number }).index]!.tone = 'next';

  for (const o of owed) if (o.remaining > 0) steps.push({ kind: 'owed', tone: 'owed', owed: o });
  return steps;
}
