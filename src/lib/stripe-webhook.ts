import type Stripe from 'stripe';
import { tenantScope } from './db';
import {
  paymentByCheckoutSession,
  paymentByIntent,
  tenantById,
  tenantByStripeAccount,
  tenantByStripeCustomer,
  updateTenantBilling,
} from './db/billing';
import { completePayment, expirePayment } from './client-payments';
import { stripe } from './stripe';
import { canStartSubscription, planForSubscription } from './subscription';

/**
 * What each Stripe event does. Every handler is safe to run twice: Stripe
 * retries, and the paid page may finish a payment before its webhook lands.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      if (session.mode === 'subscription') return subscriptionCheckout(session);
      if (session.mode === 'payment' && session.payment_status === 'paid') return clientPaid(session);
      return;
    }
    case 'checkout.session.expired': {
      const payment = await paymentByCheckoutSession(event.data.object.id);
      if (payment) await expirePayment(tenantScope(payment.tenant_id), payment.id);
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return applySubscription(event.data.object);
    case 'account.updated': {
      const account = event.data.object;
      const tenant = await tenantByStripeAccount(account.id);
      if (tenant)
        await updateTenantBilling(tenant.id, {
          stripe_charges_enabled: !!account.charges_enabled,
        });
      return;
    }
    case 'charge.refunded': {
      // A refund made in the business's own Stripe dashboard: keep the record true.
      const charge = event.data.object;
      const intent =
        typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (!intent) return;
      const payment = await paymentByIntent(intent);
      if (!payment) return;
      const full = charge.amount_refunded >= payment.amount_minor;
      await tenantScope(payment.tenant_id)
        .update('payments', {
          refunded_minor: charge.amount_refunded,
          ...(full && payment.status === 'paid' ? { status: 'refunded' as const } : {}),
        })
        .eq('id', payment.id);
      return;
    }
    default:
      return;
  }
}

async function clientPaid(session: Stripe.Checkout.Session): Promise<void> {
  const payment = await paymentByCheckoutSession(session.id);
  if (!payment) return;
  const intent =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  await completePayment(payment, intent);
}

async function subscriptionCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const tenantId = session.metadata?.tenant_id;
  const tenant = tenantId ? await tenantById(tenantId) : null;
  if (!tenant) return;
  const customer = typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null);
  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : (session.subscription?.id ?? null);
  await updateTenantBilling(tenant.id, {
    ...(customer ? { stripe_customer_id: customer } : {}),
    ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
  });
  if (subscriptionId) await applySubscription(await stripe().subscriptions.retrieve(subscriptionId));
}

async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const tenant =
    (await tenantByStripeCustomer(customer)) ??
    (sub.metadata?.tenant_id ? await tenantById(sub.metadata.tenant_id) : null);
  if (!tenant) return;
  // An old subscription ending (one the checkout route replaced) says
  // nothing about the new one the business now has.
  if (
    tenant.stripe_subscription_id &&
    tenant.stripe_subscription_id !== sub.id &&
    canStartSubscription(sub.status)
  )
    return;
  const periodEnd = sub.items?.data?.[0]?.current_period_end;
  const plan = planForSubscription(sub.status);
  await updateTenantBilling(tenant.id, {
    stripe_customer_id: customer,
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    subscription_current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    ...(plan ? { plan } : {}),
  });
}
