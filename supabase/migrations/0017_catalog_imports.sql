-- Planilha importada fica em rascunho até o usuário clicar em "Salvar planilha" ou "Deletar planilha".
create table if not exists public.catalog_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null check (kind in ('service','product')),
  file_name text not null default '',
  items jsonb not null default '[]',
  errors jsonb not null default '[]',
  total int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists catalog_imports_org on public.catalog_imports (org_id, created_at desc);
alter table public.catalog_imports enable row level security;
drop policy if exists catalog_imports_member on public.catalog_imports;
create policy catalog_imports_member on public.catalog_imports for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
