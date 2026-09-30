# Launch checklist

What is still to do before intro charges real customers. Tick items off as
they are done; the details for Stripe are in `stripe-setup.md`.

## Stripe: VAT on the subscription (saved for later)

The price is **€7 + VAT a month**. The app already asks Stripe to add VAT at
checkout, but only when all three of these are in place:

- [ ] **Vercel** (app project): set `STRIPE_AUTOMATIC_TAX` to `1`, then redeploy.
- [ ] **Stripe → Settings → Tax**: turn on Stripe Tax, add the business address
      and the country where you are registered for VAT.
- [ ] **Stripe → Product catalogue → intro → the €7 price**: Tax behaviour
      **Exclusive**, so VAT is added on top of the €7.

### Test it (in Stripe test mode first)

- [ ] Subscribe from Account with the test card `4242 4242 4242 4242` and a
      Spanish address: checkout shows €7 + 21% VAT = €8.47.
- [ ] Subscribe with an address in another EU country and a valid-format VAT
      number: checkout shows €7 with VAT reverse-charged (no VAT added).
- [ ] After paying, Account shows the plan as active and "€7 + VAT a month",
      and the renewal date is right (the webhook reached `/api/stripe/webhook`).
- [ ] "Manage billing" opens Stripe's portal; cancelling there shows on
      Account after a refresh.
- [ ] A business still in its 7-day trial is not charged until the trial ends.
- [ ] Then switch to live keys, create the live webhook, and repeat one real
      payment with your own card (refund it afterwards).

## Everything else pending

- [ ] Privacy page: fill in the four `[[ … ]]` placeholders in
      `src/app/privacy/page.tsx`.
- [ ] Terms of service page (not built yet), linked from signup.
- [ ] New name and domain; then update `NEXT_PUBLIC_MARKETING_URL`,
      `PUBLIC_BASE_URL`, the Supabase redirect URLs and the Google sign-in
      settings, and submit Google sign-in for verification.
- [ ] Email plan: Resend's free tier stops at 100 emails a day (about 15
      businesses).
