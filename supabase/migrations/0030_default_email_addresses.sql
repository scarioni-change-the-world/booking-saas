-- Default new-booking alerts and reply-to to the address a business signed
-- up with, for every tenant created before createTenant started doing this
-- itself (src/lib/db/console.ts).
--
-- Both fields (tenant_settings.notification_email, .reply_to_email) start
-- null the moment migration 0009's trigger creates the row, and nothing
-- before now ever set them to anything else — so a business that had not
-- yet visited Messages and typed its own address in was silently getting
-- no alert for a new booking, and a client's reply was going nowhere the
-- business would see it. Nobody should have to retype the address they
-- already signed up and sign in with.
--
-- Only rows still null are touched: a business that visited Messages and
-- cleared a field on purpose keeps it cleared. The address used is each
-- tenant's earliest owner — the same one the console's "owner" field named
-- when the business was created.

with owner_email as (
  select distinct on (tm.tenant_id)
    tm.tenant_id,
    u.email
  from tenant_members tm
  join auth.users u on u.id = tm.user_id
  where tm.role = 'owner' and u.email is not null
  order by tm.tenant_id, tm.created_at asc
)
update tenant_settings ts
set notification_email = coalesce(ts.notification_email, oe.email),
    reply_to_email      = coalesce(ts.reply_to_email, oe.email)
from owner_email oe
where ts.tenant_id = oe.tenant_id
  and (ts.notification_email is null or ts.reply_to_email is null);

insert into schema_migrations (version) values ('0030_default_email_addresses')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
