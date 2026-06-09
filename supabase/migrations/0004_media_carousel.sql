-- Réelgram — publications à images (photos & carrousels)
-- Spec: docs/superpowers/specs/2026-06-09-image-carousels-design.md
-- Rétro-compatible : les lignes existantes deviennent media_type='video', media=null.
alter table public.videos
  add column if not exists media_type text not null default 'video'
    check (media_type in ('video','image'));
alter table public.videos
  add column if not exists media jsonb;   -- null pour une vidéo ; tableau ordonné de slides pour un post image
