# Two-step sign-in for console owners

Console owners sign in with their password and a six-digit code from an
authenticator app (Google Authenticator, 1Password, Authy…). It uses
Supabase Auth's built-in TOTP multi-factor authentication.

- **First sign-in after this change:** the console shows a QR code. Scan it
  in the app, type the code it shows, done.
- **Every sign-in after that:** password, then the current code.
- **Enforced on the server:** every console request from an owner must carry
  a token that completed the second step (`requirePlatformStaff`,
  `src/lib/auth.ts`). Support and admin staff are not affected.

## Supabase setting

TOTP is on by default in Supabase projects. If the console says it cannot
set up the app, check Supabase → Authentication → Multi-Factor →
"Authenticator app (TOTP)" is enabled.

## Lost the phone?

There are no backup codes. Add the account to a second app (1Password,
or a second phone) when setting it up, or remove the lost one by hand in
Supabase's SQL editor and set it up again at the next sign-in:

```sql
delete from auth.mfa_factors
 where user_id = (select id from auth.users where email = 'you@example.com');
```
