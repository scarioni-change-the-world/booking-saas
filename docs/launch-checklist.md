# Launch checklist

What is still to do before khloe charges real customers. Tick items off as
they are done; the details for Stripe are in `stripe-setup.md`.

## Stripe: VAT on the subscription (saved for later)

The price is **€7 + VAT a month**. The app already asks Stripe to add VAT at
checkout, but only when all three of these are in place:

- [ ] **Vercel** (app project): set `STRIPE_AUTOMATIC_TAX` to `1`, then redeploy.
- [ ] **Stripe → Settings → Tax**: turn on Stripe Tax, add the business address
      and the country where you are registered for VAT.
- [ ] **Stripe → Product catalogue → khloe → the €7 price**: Tax behaviour
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
- [ ] **Khloe on khloe.io** (renamed in the app; see the next section for what
      is left to do outside the code).
- [ ] Email plan: Resend's free tier stops at 100 emails a day (about 15
      businesses).

## The move to khloe.io

The app's name is Khloe everywhere in the code. What is left is outside it:

- [ ] DNS: point the marketing site at `khloe.io` and the app at `app.khloe.io`
      (or whichever split you choose), both on Vercel.
- [ ] Vercel, app project: `PUBLIC_BASE_URL=https://app.khloe.io` and
      `NEXT_PUBLIC_MARKETING_URL=https://khloe.io`, then redeploy.
- [ ] Vercel, website project: `NEXT_PUBLIC_APP_URL=https://app.khloe.io` and
      `NEXT_PUBLIC_SITE_URL=https://khloe.io`.
- [x] Supabase → Authentication → URL Configuration: site URL, and the redirect
      URLs `/admin/welcome` and `/admin/reset-password` on the new app address.
- [ ] Google Cloud (sign-in and Calendar): app name Khloe, homepage and privacy
      policy on khloe.io, the new redirect URI, then submit for verification.
- [ ] Stripe: rename the business and the product to Khloe; the webhook URL
      moves to the new app address; check the checkout branding.
- [x] Support address: khloe.bookings@gmail.com (`SUPPORT_EMAIL` in
      `src/components/SignInLayout.tsx`).
- [ ] Sending: `SMTP_*` and `EMAIL_FROM_ADDRESS` in Vercel moved to the new
      account; `SIGNUP_ALERT_EMAIL` too.
- [ ] Website: `CONTACT_EMAIL` in the site's `lib/config.ts`.
- [ ] Update the privacy page placeholders, now that the domain exists.
