-- Código do item (o mesmo da planilha do cliente), opcional e único por empresa e tipo.
alter table public.catalog_items add column if not exists code text check (char_length(code) <= 40);
create unique index if not exists catalog_items_code_unique on public.catalog_items (org_id, kind, lower(code)) where code is not null;
