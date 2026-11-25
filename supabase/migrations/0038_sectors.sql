-- 0038: Setores (Balcão, Gráfica, Criação, Comunicação Visual, Brindes, ...).
-- The OS and the counter sale record which sector the job belongs to (sector_id); "Atendente" stays the
-- technician (technician_id), who also gets the commission.

create table if not exists sectors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sectors_org_name on sectors (org_id, lower(name));
create index if not exists sectors_org on sectors (org_id, position);

alter table sectors enable row level security;
drop policy if exists sectors_read on sectors;
create policy sectors_read on sectors for select to authenticated using (is_org_member(org_id));
drop policy if exists sectors_ins on sectors;
create policy sectors_ins on sectors for insert to authenticated with check (has_any_perm(org_id, array['settings']));
drop policy if exists sectors_upd on sectors;
create policy sectors_upd on sectors for update to authenticated using (has_any_perm(org_id, array['settings'])) with check (has_any_perm(org_id, array['settings']));
drop policy if exists sectors_del on sectors;
create policy sectors_del on sectors for delete to authenticated using (has_any_perm(org_id, array['settings']));

alter table service_orders add column if not exists sector_id uuid references sectors(id) on delete set null;
create index if not exists service_orders_sector on service_orders (sector_id);

-- The five default sectors, for every company now and for each new one.
create or replace function seed_default_sectors(p_org uuid) returns void
language sql security definer set search_path = public as $$
  insert into sectors (org_id, name, position)
  select p_org, s.name, s.pos
    from (values ('Balcão', 1), ('Gráfica', 2), ('Criação', 3), ('Comunicação Visual', 4), ('Brindes', 5)) s(name, pos)
   where not exists (select 1 from sectors x where x.org_id = p_org and lower(x.name) = lower(s.name));
$$;
revoke execute on function seed_default_sectors(uuid) from public, anon, authenticated;

create or replace function orgs_seed_sectors() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform seed_default_sectors(new.id);
  return new;
end $$;
revoke execute on function orgs_seed_sectors() from public, anon, authenticated;
drop trigger if exists orgs_seed_sectors on orgs;
create trigger orgs_seed_sectors after insert on orgs for each row execute function orgs_seed_sectors();

select seed_default_sectors(id) from orgs;

-- Counter sale: takes the sector (validated per company).
do $m$
declare def text;
begin
  def := pg_get_functiondef('create_counter_sale(uuid,jsonb)'::regprocedure);
  def := replace(def,
    $x$  v_tech uuid := nullif(p->>'technician_id', '')::uuid;$x$,
    $x$  v_tech uuid := nullif(p->>'technician_id', '')::uuid;
  v_sector uuid := nullif(p->>'sector_id', '')::uuid;$x$);
  def := replace(def,
    $x$  if v_tech is not null and not exists (select 1 from technicians where id = v_tech and org_id = p_org) then raise exception 'invalid_technician'; end if;$x$,
    $x$  if v_tech is not null and not exists (select 1 from technicians where id = v_tech and org_id = p_org) then raise exception 'invalid_technician'; end if;
  if v_sector is not null and not exists (select 1 from sectors where id = v_sector and org_id = p_org) then raise exception 'invalid_sector'; end if;$x$);
  def := replace(def,
    $x$         contact_phone = nullif(left(trim(coalesce(p->>'contact_phone', '')), 30), ''),$x$,
    $x$         contact_phone = nullif(left(trim(coalesce(p->>'contact_phone', '')), 30), ''),
         sector_id = v_sector,$x$);
  if position('sector_id = v_sector' in def) = 0 then raise exception 'counter sale function not patched'; end if;
  execute def;
end $m$;
