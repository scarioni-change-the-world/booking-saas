# Outlook calendars: setup

Lets a business connect an Outlook.com or Microsoft 365 calendar instead of
Google: busy times close their hours, and each booking becomes an event
(with a Teams link on work or school accounts that have Teams).

## 1. Register the app in Microsoft Entra (about 15 minutes)

1. Go to https://entra.microsoft.com (or portal.azure.com) and sign in with
   the Microsoft account that will own the app. If it asks you to create a
   directory or a free Azure account first, do that; it costs nothing.
2. **Applications → App registrations → New registration.**
   - Name: `Khloe`
   - Supported account types: **Accounts in any organizational directory and
     personal Microsoft accounts** (the multitenant + personal option).
   - Redirect URI: platform **Web**, `https://app.khloe.io/api/auth/microsoft/callback`
   - Register.
3. On the app's **Overview**, copy the **Application (client) ID**.
4. **Certificates & secrets → Client secrets → New client secret.** Description
   `khloe`, expiry 24 months. Copy the **Value** straight away (it is shown
   once). Put a reminder in your calendar to renew it before it expires.
5. **API permissions → Add a permission → Microsoft Graph → Delegated
   permissions**, and tick: `Calendars.ReadWrite`, `offline_access`
   (`User.Read` is already there). Add permissions. No admin consent needed.
6. **Branding & properties:** name Khloe, home page `https://khloe.io`,
   terms `https://app.khloe.io/terms`, privacy `https://app.khloe.io/privacy`.

## 2. Give the keys to the app

Vercel → the app project → Settings → Environment Variables:

| Variable | Value |
|---|---|
| `MICROSOFT_CLIENT_ID` | the Application (client) ID |
| `MICROSOFT_CLIENT_SECRET` | the client secret **Value** |
| `MICROSOFT_REDIRECT_URI` | `https://app.khloe.io/api/auth/microsoft/callback` |

Redeploy. `/api/health` shows `"microsoft": true`.

## 3. Test

1. Week → Your calendar → **Connect Outlook**, sign in, accept.
2. Put a busy event in Outlook; that time disappears from your booking page.
3. Book a time: the event appears in Outlook, with the client in its notes.
   The client gets khloe's confirmation only (Microsoft sends nothing).
4. Reschedule and cancel from the client's email: the event moves, then goes.

## Good to know

- One calendar at a time: connecting Outlook replaces Google, and the other
  way round. Bookings made before the switch keep their event in the old
  calendar.
- Teams links need a work or school account with Teams. Personal Outlook
  accounts get bookings without a video link.
- Until the app is **publisher verified** (Branding & properties → Publisher
  verification, which needs a free Microsoft partner account), some work or
  school organisations will ask their IT admin to approve khloe before a
  person can connect. Personal accounts are not affected.
