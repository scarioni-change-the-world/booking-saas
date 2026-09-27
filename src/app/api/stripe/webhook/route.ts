import type Stripe from 'stripe';
import { recordStripeEvent, stripeEventSeen } from '@/lib/db/billing';
import { stripe, stripeConfigured, webhookSecrets } from '@/lib/stripe';
import { handleStripeEvent } from '@/lib/stripe-webhook';

/**
 * Where Stripe says what happened — for this account (subscriptions) and for
 * connected accounts (clients paying businesses). Two endpoints can point
 * here, each with its own signing secret; an event is accepted only if one
 * of them verifies it. Nothing unsigned is ever acted on.
 *
 * A handler that throws answers 500, so Stripe tries again; an event is only
 * recorded as handled once it has been.
 */
export async function POST(request: Request) {
  const secrets = webhookSecrets();
  if (!stripeConfigured() || secrets.length === 0) {
    return new Response('Stripe is not configured', { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });
  const body = await request.text();

  let event: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = stripe().webhooks.constructEvent(body, signature, secret);
      break;
    } catch {
      // Try the other endpoint's secret.
    }
  }
  if (!event) return new Response('Invalid signature', { status: 400 });

  try {
    if (await stripeEventSeen(event.id)) return Response.json({ received: true, duplicate: true });
    await handleStripeEvent(event);
    await recordStripeEvent(event.id, event.type);
    return Response.json({ received: true });
  } catch (cause) {
    console.error(`[stripe] could not handle ${event.type} ${event.id}:`, cause);
    return new Response('Handler failed', { status: 500 });
  }
}
