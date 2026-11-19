-- is_org_member is only for RLS policies of signed-in users.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function is_org_member(uuid) from public, anon;
    grant execute on function is_org_member(uuid) to authenticated, service_role;
  end if;
end $$;
