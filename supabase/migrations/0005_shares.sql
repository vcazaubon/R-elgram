-- Réelgram — liens de partage public (spec 2026-06-12)
create table if not exists public.shares (
  id             uuid primary key default gen_random_uuid(),
  video_id       uuid not null references public.videos(id) on delete cascade,
  user_id        uuid not null references auth.users(id)    on delete cascade,
  slug           text not null unique,
  password_hash  text,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  view_count     int  not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists shares_user_created_idx on public.shares (user_id, created_at desc);
create index if not exists shares_video_idx        on public.shares (video_id);

alter table public.shares enable row level security;
drop policy if exists "own shares" on public.shares;
create policy "own shares" on public.shares
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
