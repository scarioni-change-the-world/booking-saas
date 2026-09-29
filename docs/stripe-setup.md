# Setting up Stripe

intro uses Stripe for two separate things:

1. **Businesses paying intro** — the €7 a month subscription. Stripe Billing,
   on your own Stripe account.
2. **Clients paying businesses** — a session, a deposit or a whole programme,
   paid when booked. Stripe Connect (Standard accounts): each business
   connects its own Stripe account, every charge is made on it, and intro
   takes no cut. The business pays Stripe's fee.

Without the keys below the app works exactly as before: trials and free
access as they are, and the Account page says paying online isn't switched
on yet. Do all of this in **test mode** first (the toggle top right in the
Stripe dashboard), then repeat it in live mode with live keys.

## 1. Run migration 0032

`supabase/migrations/0032_payments.sql`, in the Supabase SQL editor.

## 2. The subscription price

Stripe dashboard → **Product catalogue** → **Add product**

- Name: `intro`
- Recurring, **€7.00 / month**, with **Tax behaviour: Exclusive** — the price is €7 + VAT, so VAT is
  added on top rather than taken out of the €7
- Save, then copy the price's id (`price_…`) → `STRIPE_PRICE_ID`

## 3. Connect

Stripe dashboard → **Connect** → get started, as a **platform**. Choose
**Standard** accounts (businesses sign in to their own Stripe dashboard).
Under Connect → Settings → Branding, set the name and icon businesses see
when they connect.

## 4. The billing portal

Stripe dashboard → **Settings → Billing → Customer portal**. Turn on:
update payment method, view invoices, cancel subscription. Save.

## 5. Two webhook endpoints, one address

Stripe dashboard → **Developers → Webhooks → Add endpoint**, twice, both to

    https://YOUR-DOMAIN/api/stripe/webhook

**Endpoint A — "Events on your account"**

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Its signing secret (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`

**Endpoint B — "Events on connected accounts"**

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `account.updated`
- `charge.refunded`

Its signing secret → `STRIPE_CONNECT_WEBHOOK_SECRET`

## 6. Environment variables (Vercel → Settings → Environment Variables)

| Variable                        | Value                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`             | Developers → API keys → Secret key (`sk_test_…`, later `sk_live_…`)                     |
| `STRIPE_PRICE_ID`               | from step 2                                                                             |
| `STRIPE_WEBHOOK_SECRET`         | from endpoint A                                                                         |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | from endpoint B                                                                         |
| `STRIPE_AUTOMATIC_TAX`          | `1` to have Stripe Tax add VAT to the subscription (turn on Stripe Tax first)            |

Redeploy afterwards.

## 7. Try it (test mode)

- **Subscribing**: Account → Your plan → Subscribe. Card `4242 4242 4242 4242`,
  any future date, any CVC. A business still in its trial is not charged
  until the trial ends.
- **Connecting**: Account → Getting paid → Connect Stripe. In test mode
  Stripe offers to skip the forms.
- **A paid service**: the service’s settings → Booking rules → Paid when
  booking → Pay in full or Deposit. Book it on your page; pay with 4242….
  The booking appears on the Week once paid.
- **Refunds**: cancel that booking from the manage link more than your
  minimum notice ahead → refunded. Cancel from the Week → always refunded.
  Programme sessions are not refunded; they go back to the client's
  balance.
- **A failed card after the trial**: `4000 0000 0000 0341` attaches but
  fails when charged — the Account page shows "Update your card", and the
  booking page stays open while Stripe retries.

## How it behaves

- A time is **held for 30 minutes** while the client is on Stripe's page,
  so nobody else can take it. An abandoned payment frees it by itself.
- The booking is made when Stripe says it is paid — by the webhook or by the
  client landing back on `/t/<slug>/paid`, whichever comes first.
- If the time went anyway (rare), the payment is refunded in full at once
  and the client is told to choose another time.
- A business whose subscription ends (Stripe gives up on the card, or they
  cancel) is locked out the same way an ended trial is, with a Subscribe
  key on the lock screen. Nothing is deleted.
