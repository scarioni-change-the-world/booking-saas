# Bootstrap

One-time setup for a fresh Supabase project, for use before the CLI is wired up
or when you would rather paste into the SQL editor.

| File | When | Notes |
|---|---|---|
| `full_setup.sql` | Once, on a new project | Migrations 0001-0013 plus the dev seed, in one transaction. Ends with a verification query. |
| `02_bootstrap_owner.sql` | After creating a user in the dashboard | Links your login to the demo tenant as `owner`. Edit the email first. |
| `03_bootstrap_platform_owner.sql` | After `full_setup.sql`, for the person running the company | Makes you the platform owner, so `/console` recognises you. Edit the email first. |

`full_setup.sql` is generated from `supabase/migrations/*.sql` and
`supabase/seed.sql` — those remain the source of truth. Regenerate rather than
editing it by hand, and once the project is live use the Supabase CLI
(`supabase db push`) so migrations are tracked properly.

All three are verified against a real Postgres 16: the setup applies cleanly
and rolls back entirely on failure, and both owner scripts are idempotent.
