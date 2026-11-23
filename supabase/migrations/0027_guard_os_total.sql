-- 0020's fix (total_cents allowed) never reached the live database: Produção could not move an OS.
create or replace function guard_os_columns() returns trigger
language plpgsql security invoker set search_path = public as $$
-- total_cents is a generated column (not computed yet in a BEFORE trigger); it follows the checked amount columns.
declare allowed text[] := array['status','technical_report','internal_notes','updated_at','delivery_date','total_cents'];
begin
  if (select auth.uid()) is null or has_perm(new.org_id, 'os.edit') then return new; end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then raise exception 'permission_denied'; end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then raise exception 'permission_denied'; end if;
  return new;
end $$;
