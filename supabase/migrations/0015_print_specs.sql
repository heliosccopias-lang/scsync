-- Gráfica rápida: especificação do trabalho na OS.
alter table public.service_orders
  add column if not exists print_format text check (char_length(print_format) <= 120),
  add column if not exists print_paper text check (char_length(print_paper) <= 120),
  add column if not exists print_colors text check (char_length(print_colors) <= 40),
  add column if not exists finishing text[] not null default '{}',
  add column if not exists art_approved boolean not null default false,
  add column if not exists art_approved_at date;
