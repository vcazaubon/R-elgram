# Spec 01 — Foundation, schéma Supabase & contrats

> Lis d'abord `2026-06-07-reelgram-design.md`. Cette spec pose les fondations
> partagées par toutes les autres : structure du repo, migrations SQL Supabase
> (tables + RLS + trigger), contrat d'env, et types TypeScript partagés.

## Objectif
Mettre en place le squelette du monorepo et **le schéma de base de données
Supabase** (avec RLS et catégories par défaut), plus les artefacts partagés
(`.env.example`, types TS) que les specs suivantes consommeront.

## Hors scope
Aucune logique applicative (frontend/backend) — uniquement structure, SQL, env, types.

## Tâches

### 1. Squelette du repo
Créer l'arborescence de `Design maître §3` (dossiers vides + `.gitkeep` si besoin).
Créer un `README.md` racine minimal (sera complété par Spec 08) pointant vers
`docs/superpowers/specs/`.

### 2. Migrations Supabase — `supabase/migrations/0001_init.sql`
Contenu (SQL Postgres, compatible Supabase Cloud) :

- Tables `categories`, `videos`, `api_tokens` exactement comme `Design maître §4`.
- Index utiles : `videos(user_id, created_at desc)`, `videos(user_id, category_id)`,
  `categories(user_id, position)`, `api_tokens(token_hash)`.
- **RLS activée** sur les 3 tables, avec policies par opération :
  ```sql
  alter table public.categories enable row level security;
  create policy "own categories" on public.categories
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  -- idem videos, api_tokens
  ```
- **Trigger catégories par défaut** : fonction `public.handle_new_user()`
  (`security definer`) qui insère les 6 catégories par défaut (`Design maître §4`)
  pour le nouveau `user_id`, branchée `after insert on auth.users`.
  ```sql
  create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as $$
  begin
    insert into public.categories (user_id, label, color, position) values
      (new.id, 'À revoir', '#ff9966', 0),
      (new.id, 'Inspiration', '#a78bfa', 1),
      (new.id, 'Muscu', '#5ee2a0', 2),
      (new.id, 'Business', '#5fa8ff', 3),
      (new.id, 'Humour', '#ffd166', 4),
      (new.id, 'Idées', '#ff7eb3', 5);
    return new;
  end; $$;
  create trigger on_auth_user_created
    after insert on auth.users for each row execute function public.handle_new_user();
  ```
- Activer l'extension `pgcrypto` si nécessaire pour `gen_random_uuid()`
  (sur Supabase c'est dispo via `gen_random_uuid()` natif — sinon `create extension if not exists pgcrypto;`).

Fournir aussi `supabase/migrations/README.md` expliquant comment appliquer :
- via le **SQL Editor** du dashboard Supabase (copier-coller), **ou**
- via `supabase db push` (CLI) si le repo est lié au projet.

### 3. `.env.example` (racine)
Documenter **toutes** les variables de `Design maître §6` (frontend runtime +
backend), avec commentaires expliquant où trouver chaque valeur dans le dashboard
Supabase (Project Settings → API : URL, anon key, service_role key, JWT secret).

### 4. Types TS partagés — `frontend/src/lib/types.ts`
(Le dossier `frontend/src/lib/` est créé ici ; Vite est scaffoldé en Spec 03.)
Définir les types reflétant le data model et le contrat d'API :
```ts
export type VideoStatus = 'analyzing' | 'fetching' | 'thumbnailing' | 'ready' | 'error';
export interface Category { id: string; label: string; color: string; position: number; }
export interface Video {
  id: string; category_id: string | null; source_url: string; title: string;
  author: string | null; duration_seconds: number | null; thumb_color: string;
  status: VideoStatus; error: string | null; created_at: string;
}
export interface IngestStatus { status: VideoStatus; step: number; error: string | null; }
export interface ApiToken { id: string; label: string; created_at: string; last_used_at: string | null; }
```

## Critères d'acceptation
- L'arborescence du `Design maître §3` existe.
- `0001_init.sql` s'applique sans erreur sur un projet Supabase vierge ; les 3
  tables existent avec RLS active et le trigger en place.
- Créer un user de test (dashboard) crée automatiquement ses 6 catégories.
- Une requête `select` sur `categories`/`videos` avec un JWT user A ne renvoie
  jamais les rows d'un user B (RLS vérifiée).
- `.env.example` liste toutes les variables documentées.
- `frontend/src/lib/types.ts` compile (types seuls).

## Notes pour les specs suivantes
- Le backend (Spec 02) utilise `SUPABASE_SERVICE_ROLE_KEY` pour insérer/mettre à
  jour `videos` (bypass RLS) et fixe `user_id` depuis le JWT/token validé.
- Le frontend (Spec 04/05) lit `categories`/`videos` directement via supabase-js (RLS).
