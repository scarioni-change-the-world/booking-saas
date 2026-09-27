import { DateTime } from 'luxon';
import { baseUrl } from './base-url';
import { assertTimesBookable, BookingError, createBooking, createBookingPack } from './booking-service';
import { tenantScope, type TenantScope } from './db';
import { tenantById } from './db/billing';
import type { BookingRow, EventTypeRow, PaymentBookingInput, PaymentRow, TenantRow } from './db/types';
import { DEFAULT_CURRENCY } from './money';
import { amountDue, HOLD_MINUTES, refundDecision, type AmountDue } from './payments';
import { stripe, stripeConfigured } from './stripe';

/**
 * Clients paying a business, through the business's own Stripe account.
 *
 * The order of things is the whole design:
 *
 *   1. The times are checked, then held (a `payments` row, status 'open',
 *      with an expiry) and the client is sent to Stripe's payment page.
 *   2. Only when Stripe says the money arrived are the bookings written —
 *      by whichever comes first, the webhook or the client landing back on
 *      the paid page. Claiming the payment ('open' → 'paid') is the lock that
 *      makes the second of those a no-op.
 *   3. If the time went while they paid (a race the hold makes rare but not
 *      impossible), the money goes straight back and they are told.
 *
 * A charge is made on the business's account (a direct charge), so the
 * business is the seller, sees it in its own Stripe, and pays Stripe's fee.
 * intro takes nothing.
 */

/** What a client pays online for this service, or null when nothing is paid online here. */
export function onlinePaymentFor(tenant: TenantRow, eventType: EventTypeRow): AmountDue | null {
  if (!stripeConfigured() || !tenant.stripe_account_id || !tenant.stripe_charges_enabled) return null;
  return amountDue({
    priceMinor: eventType.price_minor,
    paymentMode: eventType.payment_mode ?? 'none',
    depositMinor: eventType.deposit_minor ?? null,
    bookingMode: eventType.booking_mode,
    packSize: eventType.pack_size,
  });
}

export interface PublicPayNow {
  kind: 'full' | 'deposit';
  amountMinor: number;
  totalMinor: number;
  /** Cancelled at least this many hours ahead, it is refunded automatically. */
  refundHours: number;
}

async function noticeHoursOf(scope: TenantScope): Promise<number> {
  const { data } = await scope.select('tenant_settings', 'booking_notice_hours').maybeSingle();
  return (data as { booking_notice_hours?: number } | null)?.booking_notice_hours ?? 24;
}

/**
 * For a page listing services: a function giving each one's online payment
 * as a visitor sees it, or null. Reads the business's notice once.
 */
export async function publicPayNow(
  tenant: TenantRow,
  scope: TenantScope,
): Promise<(eventType: EventTypeRow) => PublicPayNow | null> {
  const refundHours = await noticeHoursOf(scope);
  return (eventType) => {
    const due = onlinePaymentFor(tenant, eventType);
    return due
      ? {
          kind: due.kind,
          amountMinor: due.amountMinor,
          totalMinor: due.totalMinor,
          refundHours,
        }
      : null;
  };
}

async function currencyOf(scope: TenantScope): Promise<string> {
  const { data } = await scope.select('tenant_settings', 'currency').maybeSingle();
  return ((data as { currency?: string } | null)?.currency ?? DEFAULT_CURRENCY).toUpperCase();
}

/**
 * Hold the times and send the client to pay. Returns Stripe's page address.
 */
export async function startCheckout(
  tenant: TenantRow,
  scope: TenantScope,
  eventType: EventTypeRow,
  input: PaymentBookingInput,
): Promise<{ url: string }> {
  const due = onlinePaymentFor(tenant, eventType);
  if (!due) throw new BookingError('This service is not paid online', 400);

  const times = input.slots ? [...new Set(input.slots)].sort() : input.startsAt ? [input.startsAt] : [];
  if (input.slots) {
    if (eventType.booking_mode !== 'pack' || !eventType.pack_size) {
      throw new BookingError('That service is not booked as a pack', 400);
    }
    if (times.length !== eventType.pack_size) {
      throw new BookingError(
        `This programme is ${eventType.pack_size} appointments — please choose ${eventType.pack_size} times`,
        400,
      );
    }
  }
  if (times.length === 0) throw new BookingError('Choose a time first', 400);

  // Nobody pays for a time that has already gone.
  await assertTimesBookable(tenant, scope, eventType.id, times);

  const currency = await currencyOf(scope);
  const expiresAt = DateTime.utc().plus({ minutes: HOLD_MINUTES, seconds: 60 });
  const ranges = times.map((iso) => {
    const start = DateTime.fromISO(iso, { zone: 'utc' });
    return {
      start: start.toISO()!,
      end: start.plus({ minutes: eventType.duration_minutes }).toISO()!,
    };
  });

  const { data, error } = await scope.insert('payments', {
    event_type_id: eventType.id,
    kind: input.slots ? 'pack' : 'single',
    status: 'open',
    amount_minor: due.amountMinor,
    currency,
    payment_mode: due.kind,
    booking_input: { ...input, slots: input.slots ? times : undefined },
    slot_ranges: ranges,
    expires_at: expiresAt.toISO()!,
    stripe_account_id: tenant.stripe_account_id!,
  });
  if (error) throw error;
  const payment = (data as unknown as PaymentRow[])[0]!;

  const slug = encodeURIComponent(tenant.slug);
  const back =
    input.from === 'client-link' && input.clientToken
      ? `${baseUrl()}/t/${slug}/client/${encodeURIComponent(input.clientToken)}`
      : `${baseUrl()}/t/${slug}`;
  const what = due.sessions > 1 ? `${eventType.name} — ${due.sessions} sessions` : eventType.name;

  try {
    const session = await stripe().checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: due.amountMinor,
              product_data: {
                name: due.kind === 'deposit' ? `${what} (deposit)` : what,
              },
            },
          },
        ],
        customer_email: input.email,
        client_reference_id: payment.id,
        metadata: { payment_id: payment.id, tenant_id: tenant.id },
        // Stripe emails the receipt, from the business, whatever its own receipt setting.
        payment_intent_data: {
          receipt_email: input.email,
          metadata: { payment_id: payment.id, tenant_id: tenant.id },
        },
        expires_at: Math.floor(expiresAt.toSeconds()),
        success_url: `${baseUrl()}/t/${slug}/paid?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: back,
      },
      { stripeAccount: tenant.stripe_account_id! },
    );
    await scope.update('payments', { stripe_checkout_session_id: session.id }).eq('id', payment.id);
    if (!session.url) throw new Error('Stripe returned no payment page');
    return { url: session.url };
  } catch (cause) {
    // No page to pay on means no hold worth keeping.
    await scope.update('payments', { status: 'expired' }).eq('id', payment.id);
    throw cause;
  }
}

export type PaymentOutcome =
  | {
      status: 'paid';
      payment: PaymentRow;
      bookings: BookingRow[];
      clientToken: string | null;
    }
  | { status: 'failed'; payment: PaymentRow; message: string }
  | { status: 'pending' }
  | { status: 'expired' };

async function bookingsOf(scope: TenantScope, paymentId: string): Promise<BookingRow[]> {
  const { data, error } = await scope
    .select('bookings')
    .eq('payment_id', paymentId)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as BookingRow[];
}

async function settled(scope: TenantScope, payment: PaymentRow): Promise<PaymentOutcome> {
  if (payment.status === 'failed') {
    return {
      status: 'failed',
      payment,
      message: 'That time was taken while you were paying, so your payment was refunded.',
    };
  }
  if (payment.status === 'expired') return { status: 'expired' };
  if (payment.status === 'open') return { status: 'pending' };
  return {
    status: 'paid',
    payment,
    bookings: await bookingsOf(scope, payment.id),
    clientToken: payment.booking_input.clientToken ?? null,
  };
}

/**
 * Stripe says it is paid: write the bookings. Safe to call twice — only the
 * call that claims the payment does anything.
 */
export async function completePayment(
  payment: PaymentRow,
  paymentIntentId: string | null,
): Promise<PaymentOutcome> {
  const scope = tenantScope(payment.tenant_id);
  const { data: claimed, error } = await scope
    .update('payments', {
      status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq('id', payment.id)
    .eq('status', 'open')
    .select();
  if (error) throw error;
  if (!claimed || (claimed as unknown[]).length === 0) {
    const { data: current } = await scope.select('payments').eq('id', payment.id).maybeSingle();
    return settled(scope, (current as unknown as PaymentRow) ?? payment);
  }

  const tenant = await tenantById(payment.tenant_id);
  if (!tenant) throw new Error(`Payment ${payment.id} belongs to no business`);
  const input = payment.booking_input;
  const common = {
    eventTypeId: input.eventTypeId,
    name: input.name,
    email: input.email,
    notes: input.notes,
    qualificationResponseId: input.qualificationResponseId ?? null,
    clientId: input.clientId ?? null,
    paymentId: payment.id,
  };

  try {
    if (input.slots) {
      const created = await createBookingPack(tenant, scope, {
        ...common,
        slots: input.slots,
      });
      return {
        status: 'paid',
        payment,
        bookings: created.bookings,
        clientToken: input.clientToken ?? created.clientToken,
      };
    }
    const booking = await createBooking(tenant, scope, {
      ...common,
      startsAt: input.startsAt!,
    });
    return {
      status: 'paid',
      payment,
      bookings: [booking],
      clientToken: input.clientToken ?? null,
    };
  } catch (cause) {
    if (cause instanceof BookingError) {
      // The time went while they paid. Their money goes straight back.
      await refund(
        scope,
        { ...payment, stripe_payment_intent_id: paymentIntentId },
        payment.amount_minor,
        'failed',
      );
      const { data: current } = await scope.select('payments').eq('id', payment.id).maybeSingle();
      return settled(scope, current as unknown as PaymentRow);
    }
    // Anything else: let go of the claim so Stripe's retry can finish it.
    await scope.update('payments', { status: 'open', paid_at: null }).eq('id', payment.id);
    throw cause;
  }
}

async function refund(
  scope: TenantScope,
  payment: PaymentRow,
  amountMinor: number,
  status: 'refunded' | 'failed',
): Promise<void> {
  if (!payment.stripe_payment_intent_id)
    throw new Error(`Payment ${payment.id} has no Stripe payment to refund`);
  await stripe().refunds.create(
    {
      payment_intent: payment.stripe_payment_intent_id,
      amount: amountMinor,
      metadata: { payment_id: payment.id },
    },
    { stripeAccount: payment.stripe_account_id },
  );
  await scope
    .update('payments', {
      status,
      refunded_minor: payment.refunded_minor + amountMinor,
    })
    .eq('id', payment.id);
}

/**
 * The client came back from Stripe. Finish the payment if the webhook has
 * not yet, and say where it stands.
 */
export async function confirmReturn(
  tenant: TenantRow,
  scope: TenantScope,
  sessionId: string,
): Promise<PaymentOutcome | null> {
  const { data, error } = await scope
    .select('payments')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle();
  if (error) throw error;
  const payment = data as unknown as PaymentRow | null;
  if (!payment) return null;
  if (payment.status !== 'open') return settled(scope, payment);

  const session = await stripe().checkout.sessions.retrieve(
    sessionId,
    {},
    { stripeAccount: payment.stripe_account_id },
  );
  if (session.payment_status === 'paid') {
    const intent =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);
    return completePayment(payment, intent);
  }
  if (session.status === 'expired') {
    await expirePayment(scope, payment.id);
    return { status: 'expired' };
  }
  return { status: 'pending' };
}

export async function expirePayment(scope: TenantScope, paymentId: string): Promise<void> {
  await scope.update('payments', { status: 'expired' }).eq('id', paymentId).eq('status', 'open');
}

export interface BookingPayment {
  amountMinor: number;
  currency: string;
  kind: 'full' | 'deposit';
  /** What a client cancelling now would get: their money back, or not. */
  ifCancelledNow: 'refund' | 'kept' | 'programme' | 'refunded';
  refundHours: number;
}

/** A booking's payment, as its manage page shows it — or null when nothing was paid online. */
export async function bookingPayment(
  scope: TenantScope,
  booking: BookingRow,
): Promise<BookingPayment | null> {
  if (!booking.payment_id) return null;
  const { data } = await scope.select('payments').eq('id', booking.payment_id).maybeSingle();
  const payment = data as unknown as PaymentRow | null;
  if (!payment || (payment.status !== 'paid' && payment.status !== 'refunded')) return null;
  const refundHours = await noticeHoursOf(scope);
  const remaining = payment.amount_minor - payment.refunded_minor;
  const decision = refundDecision({
    by: 'client',
    startsAt: booking.starts_at,
    now: new Date(),
    noticeHours: refundHours,
    inProgramme: !!booking.pack_id,
    paid: payment.status === 'paid' && remaining > 0,
  });
  return {
    amountMinor: payment.amount_minor,
    currency: payment.currency,
    kind: payment.payment_mode,
    ifCancelledNow: decision.refund
      ? 'refund'
      : decision.reason === 'programme'
        ? 'programme'
        : decision.reason === 'late'
          ? 'kept'
          : 'refunded',
    refundHours,
  };
}

export interface RefundOutcome {
  status: 'refunded' | 'kept' | 'failed';
  amountMinor: number;
  currency: string;
}

/**
 * A booking was cancelled: refund it when the rules say so (payments.ts).
 * Never throws — the cancellation has already happened, and a refund that
 * could not be started is reported rather than lost.
 */
export async function refundOnCancel(
  scope: TenantScope,
  booking: BookingRow,
  by: 'client' | 'business',
): Promise<RefundOutcome | null> {
  if (!booking.payment_id) return null;
  try {
    const { data } = await scope.select('payments').eq('id', booking.payment_id).maybeSingle();
    const payment = data as unknown as PaymentRow | null;
    if (!payment) return null;
    const noticeHours = await noticeHoursOf(scope);
    const remaining = payment.amount_minor - payment.refunded_minor;
    const decision = refundDecision({
      by,
      startsAt: booking.starts_at,
      now: new Date(),
      noticeHours,
      inProgramme: !!booking.pack_id,
      paid: payment.status === 'paid' && remaining > 0,
    });
    if (!decision.refund) {
      return decision.reason === 'late'
        ? {
            status: 'kept',
            amountMinor: payment.amount_minor,
            currency: payment.currency,
          }
        : null;
    }
    try {
      await refund(scope, payment, remaining, 'refunded');
      return {
        status: 'refunded',
        amountMinor: remaining,
        currency: payment.currency,
      };
    } catch (cause) {
      console.error('[payments] refund on cancellation failed:', cause);
      return {
        status: 'failed',
        amountMinor: remaining,
        currency: payment.currency,
      };
    }
  } catch (cause) {
    console.error('[payments] could not work out a refund on cancellation:', cause);
    return null;
  }
}
