/**
 * The rules for clients paying a business — pure, so the settings page, the
 * booking page and the routes all read the same answers.
 *
 * The business is the seller: every payment is a charge on the business's
 * own Stripe account (Stripe Connect, direct charges), and intro takes no
 * cut. What intro decides is only when a payment is asked for, how much, and
 * when a cancellation is refunded.
 */

export type PaymentMode = 'none' | 'full' | 'deposit';

export const PAYMENT_MODES: readonly PaymentMode[] = ['none', 'full', 'deposit'];

/**
 * How long a time is held for somebody on Stripe's payment page. Stripe's
 * own shortest expiry for a Checkout Session is 30 minutes, and a hold must
 * not outlive the session that can complete it.
 */
export const HOLD_MINUTES = 30;

export interface PayableService {
  priceMinor: number | null;
  paymentMode: PaymentMode;
  depositMinor: number | null;
  bookingMode: 'single' | 'pack';
  packSize: number | null;
}

export interface AmountDue {
  kind: 'full' | 'deposit';
  /** Charged now, in the currency's minor unit. */
  amountMinor: number;
  /** The whole price of what is being bought: one session, or the programme. */
  totalMinor: number;
  sessions: number;
}

/**
 * What a client pays online for one purchase — a session, or a whole
 * programme — or null when nothing is paid online. A price of zero, or no
 * price at all, is never charged, whatever the setting says.
 */
export function amountDue(service: PayableService): AmountDue | null {
  if (service.paymentMode === 'none') return null;
  if (service.priceMinor === null || service.priceMinor <= 0) return null;
  const sessions = service.bookingMode === 'pack' && service.packSize ? service.packSize : 1;
  const totalMinor = service.priceMinor * sessions;
  if (service.paymentMode === 'full') {
    return { kind: 'full', amountMinor: totalMinor, totalMinor, sessions };
  }
  if (!service.depositMinor || service.depositMinor <= 0) return null;
  return {
    kind: 'deposit',
    amountMinor: Math.min(service.depositMinor, totalMinor),
    totalMinor,
    sessions,
  };
}

/**
 * Why a service's payment setting cannot be saved, or null when it can.
 * The route refuses what this refuses; the settings page says it first.
 */
export function paymentSettingProblem(service: PayableService): string | null {
  if (service.paymentMode === 'none') return null;
  if (service.priceMinor === null || service.priceMinor <= 0) {
    return 'Set a price first — there is nothing to charge.';
  }
  if (service.paymentMode === 'deposit') {
    if (!service.depositMinor || service.depositMinor <= 0) return 'Enter the deposit.';
    const sessions = service.bookingMode === 'pack' && service.packSize ? service.packSize : 1;
    if (service.depositMinor >= service.priceMinor * sessions) {
      return 'A deposit must be less than the full price. Choose “Pay in full” instead.';
    }
  }
  return null;
}

export interface RefundInput {
  /** Who cancelled: the client from their own link, or the business. */
  by: 'client' | 'business';
  startsAt: string;
  now: Date;
  /** The business's minimum notice, in hours. */
  noticeHours: number;
  /** One appointment of a programme. */
  inProgramme: boolean;
  /** A payment was taken for it and has not been refunded. */
  paid: boolean;
}

export type RefundDecision =
  | { refund: true; reason: 'business-cancelled' | 'in-time' }
  | { refund: false; reason: 'not-paid' | 'programme' | 'late' };

/**
 * Whether cancelling refunds the payment.
 *
 * A cancelled appointment of a programme is not refunded: the session goes
 * back to the client to book again, which is what they paid for. Otherwise
 * the business cancelling always refunds, and a client cancelling refunds
 * when they did it at least the business's minimum notice ahead — the same
 * line the business already drew for how late somebody may book.
 */
export function refundDecision(input: RefundInput): RefundDecision {
  if (!input.paid) return { refund: false, reason: 'not-paid' };
  if (input.inProgramme) return { refund: false, reason: 'programme' };
  if (input.by === 'business') return { refund: true, reason: 'business-cancelled' };
  const hoursAhead = (new Date(input.startsAt).getTime() - input.now.getTime()) / 3_600_000;
  return hoursAhead >= input.noticeHours
    ? { refund: true, reason: 'in-time' }
    : { refund: false, reason: 'late' };
}

export interface HeldRange {
  start: string;
  end: string;
}

export interface HoldLike {
  status: string;
  expires_at: string | null;
  slot_ranges: HeldRange[] | null;
}

/**
 * Times held for somebody who is on the payment page right now. They are
 * busy for everybody else until the hold is paid or runs out; an expired
 * hold frees its times by itself, without anything having to clean it up.
 */
export function heldBusy(
  holds: readonly HoldLike[],
  now: Date,
  exceptId?: string,
  ids?: readonly string[],
): HeldRange[] {
  return holds.flatMap((hold, i) => {
    if (exceptId && ids?.[i] === exceptId) return [];
    if (hold.status !== 'open' || !hold.expires_at) return [];
    if (new Date(hold.expires_at).getTime() <= now.getTime()) return [];
    return hold.slot_ranges ?? [];
  });
}
