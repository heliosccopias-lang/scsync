-- Etapa 3: checklists e anexos.

-- A checklist used on an OS is locked: changing it would rewrite answers already given. Edit = duplicate.
create or replace function lock_checklist_on_use() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update checklists set locked = true, updated_at = now() where id = new.checklist_id and not locked;
  return new;
end $$;

drop trigger if exists checklist_runs_lock on checklist_runs;
create trigger checklist_runs_lock after insert on checklist_runs
for each row execute function lock_checklist_on_use();

create or replace function guard_locked_checklist() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from checklists where id = coalesce(new.checklist_id, old.checklist_id) and locked) then
    raise exception 'checklist_locked';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists checklist_questions_locked on checklist_questions;
create trigger checklist_questions_locked before insert or update or delete on checklist_questions
for each row execute function guard_locked_checklist();

-- Copy a checklist (to change one that is locked).
create or replace function duplicate_checklist(p_checklist uuid)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  c checklists%rowtype;
  v_new uuid;
begin
  select * into c from checklists where id = p_checklist;
  if not found then raise exception 'not_found'; end if;
  insert into checklists (org_id, name, mode) values (c.org_id, c.name || ' (cópia)', c.mode) returning id into v_new;
  insert into checklist_questions (org_id, checklist_id, position, prompt, type, options, required, comment_required, comment_required_options)
  select org_id, v_new, position, prompt, type, options, required, comment_required, comment_required_options
    from checklist_questions where checklist_id = c.id;
  return v_new;
end $$;

-- Storage for OS attachments and checklist photos: private bucket, files under <org_id>/...
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('attachments', 'attachments', false, 5242880)
    on conflict (id) do update set public = false, file_size_limit = 5242880;

    execute $p$drop policy if exists "attachments_read" on storage.objects$p$;
    execute $p$drop policy if exists "attachments_write" on storage.objects$p$;
    execute $p$drop policy if exists "attachments_delete" on storage.objects$p$;
    execute $p$create policy "attachments_read" on storage.objects for select to authenticated
      using (bucket_id = 'attachments' and public.is_org_member(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy "attachments_write" on storage.objects for insert to authenticated
      with check (bucket_id = 'attachments' and public.is_org_member(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy "attachments_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'attachments' and public.is_org_member(((storage.foldername(name))[1])::uuid))$p$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function lock_checklist_on_use() from public, anon, authenticated;
    revoke execute on function guard_locked_checklist() from public, anon, authenticated;
    revoke execute on function duplicate_checklist(uuid) from public, anon;
    grant execute on function duplicate_checklist(uuid) to authenticated;
  end if;
end $$;
