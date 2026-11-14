-- Deleting a business for good, from the owner console.
--
-- Every table that holds a business's data references tenants with
-- "on delete cascade", so deleting the tenants row removes all of it and
-- frees its web address. Two links stand in the way: bookings and
-- client_entitlements reference event_types with "on delete restrict"
-- (a service with history must never vanish from under it, migration
-- 0029). Inside one cascade the order is not guaranteed, so those two go
-- first, explicitly, then the business.
--
-- One function, one transaction: a failure part-way leaves the business
-- exactly as it was, never half-deleted. Only the server (service role)
-- may call it; the route in front of it checks who is asking and why.

create or replace function delete_tenant(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from bookings where tenant_id = p_tenant;
  delete from client_entitlements where tenant_id = p_tenant;
  delete from tenants where id = p_tenant;
  if not found then
    raise exception 'No business with id %', p_tenant using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function delete_tenant(uuid) from public;
revoke all on function delete_tenant(uuid) from anon, authenticated;
grant execute on function delete_tenant(uuid) to service_role;

insert into schema_migrations (version) values ('0037_delete_business')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
