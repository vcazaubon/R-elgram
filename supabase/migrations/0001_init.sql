-- Réelgram — schéma initial (Supabase Postgres)
create extension if not exists pgcrypto;

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text not null,
  color       text not null default '#a78bfa',
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists categories_user_position_idx on public.categories (user_id, position);

create table if not exists public.videos (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  category_id       uuid references public.categories(id) on delete set null,
  source_url        text not null,
  title             text not null default 'Sans titre',
  author            text,
  duration_seconds  int,
  thumb_color       text default '#a78bfa',
  status            text not null default 'analyzing',
  error             text,
  storage_path      text,
  thumb_path        text,
  created_at        timestamptz not null default now()
);
create index if not exists videos_user_created_idx on public.videos (user_id, created_at desc);
create index if not exists videos_user_category_idx on public.videos (user_id, category_id);
alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check
  check (status in ('analyzing','fetching','thumbnailing','ready','error'));

create table if not exists public.api_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  token_hash    text not null unique,
  label         text not null default 'Raccourci iOS',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists api_tokens_hash_idx on public.api_tokens (token_hash);

alter table public.categories enable row level security;
alter table public.videos     enable row level security;
alter table public.api_tokens enable row level security;

drop policy if exists "own categories" on public.categories;
create policy "own categories" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own videos" on public.videos;
create policy "own videos" on public.videos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own api_tokens" on public.api_tokens;
create policy "own api_tokens" on public.api_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.categories (user_id, label, color, position) values
    (new.id, 'À revoir',     '#ff9966', 0),
    (new.id, 'Inspiration',  '#a78bfa', 1),
    (new.id, 'Muscu',        '#5ee2a0', 2),
    (new.id, 'Business',     '#5fa8ff', 3),
    (new.id, 'Humour',       '#ffd166', 4),
    (new.id, 'Idées',        '#ff7eb3', 5);
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();
