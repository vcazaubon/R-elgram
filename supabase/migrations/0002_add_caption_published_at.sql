-- Réelgram — légende + date de publication (titres parlants)
-- Spec: docs/superpowers/specs/2026-06-08-reel-titles-from-caption-design.md
alter table public.videos add column if not exists caption      text;
alter table public.videos add column if not exists published_at timestamptz;
