# Réelgram Spec 01 — Foundation & schéma Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser les fondations du monorepo Réelgram et le schéma Postgres Supabase (tables + RLS + trigger catégories par défaut), plus `.env.example` et les types TS partagés.

**Architecture:** Monorepo (`frontend/`, `backend/`, `supabase/`, `docs/`). Le schéma est défini dans une migration SQL idempotente, vérifiée par un harness Postgres éphémère (`pg_virtualenv`) qui stub `auth.users`/`auth.uid()`, applique la migration et teste le trigger + l'isolation RLS sous un rôle non-propriétaire. Les types TS reflètent le data model.

**Tech Stack:** PostgreSQL 15+ (test local via `pg_virtualenv` de `postgresql-common`), SQL Supabase, TypeScript 5 (vérif `tsc` standalone).

---

## File Structure
- `supabase/migrations/0001_init.sql` — schéma (tables, index, RLS, trigger). Responsabilité : tout le DDL initial.
- `supabase/migrations/README.md` — comment appliquer (SQL Editor / CLI).
- `supabase/test/schema_test.sql` — harness : stub auth + `\i` migration + assertions (trigger, RLS).
- `supabase/test/run_schema_test.sh` — lance le harness dans un cluster PG éphémère.
- `.env.example` — contrat de variables (frontend runtime + backend).
- `frontend/src/lib/types.ts` — types partagés (data model + API).
- `README.md` — présentation minimale (complété en Spec 08).

---

## Task 1: Squelette repo + `.env.example` + README

**Files:**
- Create: `.env.example`, `README.md`
- Create (placeholders dirs): `frontend/src/lib/.gitkeep`, `backend/.gitkeep`, `supabase/test/.gitkeep`

- [ ] **Step 1: Créer l'arborescence + `.env.example`**

`.env.example` (contenu exact) :
```bash
# Supabase (Project Settings → API)
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...                 # anon public (frontend)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...         # service_role (backend, SECRET)
SUPABASE_JWT_SECRET=super-secret-jwt-...        # API → JWT Secret (backend)
# Backend
MEDIA_TOKEN_SECRET=change-me-random-hex         # openssl rand -hex 32
DATA_DIR=/data
MAX_VIDEO_MB=300
IG_COOKIES_FILE=/secrets/ig_cookies.txt
IG_COOKIES_HOST_PATH=/dev/null
# Frontend (runtime via env.js, valeurs publiques)
API_URL=/api
ALLOW_SIGNUPS=true
```

`README.md` : 8-12 lignes présentant Réelgram + pointeurs `docs/superpowers/specs/`, `design-reference/`, `supabase/migrations/`.

- [ ] **Step 2: Vérifier que `.env.example` documente toutes les variables du Design maître §6**

Run: `grep -E 'SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_JWT_SECRET|MEDIA_TOKEN_SECRET|DATA_DIR|IG_COOKIES_FILE|MAX_VIDEO_MB|API_URL|ALLOW_SIGNUPS' .env.example | wc -l`
Expected: `10`

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md frontend backend supabase
git commit -m "Spec 01 T1: repo skeleton + .env.example + README"
```

---

## Task 2: Harness de test du schéma (TEST FIRST)

**Files:**
- Create: `supabase/test/schema_test.sql`
- Create: `supabase/test/run_schema_test.sh`

- [ ] **Step 1: Installer PostgreSQL de test**

Run: `sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib postgresql-common && which pg_virtualenv`
Expected: chemin de `pg_virtualenv` affiché.

- [ ] **Step 2: Écrire le harness SQL** (`supabase/test/schema_test.sql`)

```sql
-- Stub de l'environnement Supabase pour tester la migration en Postgres vanilla.
\set ON_ERROR_STOP on
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
-- auth.uid() lit un GUC de session (simule le JWT sub)
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- ====== Applique la migration réelle ======
\i :migration

-- ====== Rôle non-propriétaire pour FORCER l'application des RLS ======
create role app_user nologin;
grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;

-- ====== TEST 1 : trigger -> 6 catégories par défaut ======
do $$
declare uid_a uuid;
begin
  insert into auth.users (email) values ('a@test.io') returning id into uid_a;
  perform set_config('app.test_uid_a', uid_a::text, false);
  if (select count(*) from public.categories where user_id = uid_a) <> 6 then
    raise exception 'TRIGGER FAIL: attendu 6 catégories, obtenu %',
      (select count(*) from public.categories where user_id = uid_a);
  end if;
  raise notice 'TEST1 OK: 6 catégories créées par le trigger';
end $$;

-- ====== TEST 2 : isolation RLS sous app_user ======
do $$
declare uid_a uuid; uid_b uuid;
begin
  select id into uid_a from auth.users where email='a@test.io';
  insert into auth.users (email) values ('b@test.io') returning id into uid_b;
  insert into public.videos (user_id, source_url) values (uid_a, 'https://instagram.com/reel/a');
  insert into public.videos (user_id, source_url) values (uid_b, 'https://instagram.com/reel/b');
  perform set_config('app.test_uid_a', uid_a::text, false);
  perform set_config('app.test_uid_b', uid_b::text, false);
end $$;

set role app_user;
select set_config('app.user_id', current_setting('app.test_uid_a'), false);
do $$
begin
  if (select count(*) from public.videos) <> 1 then
    raise exception 'RLS FAIL (user A): attendu 1 vidéo visible, obtenu %',
      (select count(*) from public.videos);
  end if;
  raise notice 'TEST2a OK: user A ne voit que sa vidéo';
end $$;
select set_config('app.user_id', current_setting('app.test_uid_b'), false);
do $$
begin
  if (select count(*) from public.videos) <> 1 then
    raise exception 'RLS FAIL (user B): attendu 1 vidéo visible, obtenu %',
      (select count(*) from public.videos);
  end if;
  raise notice 'TEST2b OK: user B ne voit que sa vidéo';
end $$;
reset role;

-- ====== TEST 3 : RLS activée sur les 3 tables ======
do $$
declare n int;
begin
  select count(*) into n from pg_tables
   where schemaname='public' and tablename in ('categories','videos','api_tokens') and rowsecurity=true;
  if n <> 3 then raise exception 'RLS FAIL: % tables avec RLS (attendu 3)', n; end if;
  raise notice 'TEST3 OK: RLS activée sur les 3 tables';
end $$;

select 'ALL SCHEMA TESTS PASSED' as result;
```

- [ ] **Step 3: Écrire le runner** (`supabase/test/run_schema_test.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATION="$HERE/../migrations/0001_init.sql"
# Cluster Postgres éphémère (auto-créé/détruit par pg_virtualenv)
sudo pg_virtualenv bash -c "
  psql -v ON_ERROR_STOP=1 -v migration='$MIGRATION' -f '$HERE/schema_test.sql'
"
```

- [ ] **Step 4: Rendre exécutable et lancer SANS migration (doit ÉCHOUER)**

Run: `chmod +x supabase/test/run_schema_test.sh && ./supabase/test/run_schema_test.sh`
Expected: ÉCHEC — `0001_init.sql` n'existe pas encore → `\i` erreur (fichier introuvable) ou tests qui échouent. C'est le rouge attendu (TDD).

- [ ] **Step 5: Commit**

```bash
git add supabase/test
git commit -m "Spec 01 T2: harness de test schéma (RLS + trigger) — rouge"
```

---

## Task 3: Migration `0001_init.sql` (rendre le harness vert)

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `supabase/migrations/README.md`

- [ ] **Step 1: Écrire `0001_init.sql`**

Contenu : exactement le schéma du Design maître §4 et de la Spec 01 :
- `create extension if not exists pgcrypto;`
- table `public.categories` (id, user_id FK auth.users on delete cascade, label, color default '#a78bfa', position, created_at) + index `(user_id, position)`.
- table `public.videos` (id, user_id, category_id FK categories on delete set null, source_url, title default 'Sans titre', author, duration_seconds, thumb_color default '#a78bfa', status default 'analyzing', error, storage_path, thumb_path, created_at) + index `(user_id, created_at desc)` et `(user_id, category_id)` + contrainte CHECK status in (analyzing,fetching,thumbnailing,ready,error).
- table `public.api_tokens` (id, user_id, token_hash unique, label default 'Raccourci iOS', created_at, last_used_at) + index `(token_hash)`.
- `enable row level security` + policy `for all using (auth.uid()=user_id) with check (auth.uid()=user_id)` sur les 3 tables (drop policy if exists d'abord).
- fonction `public.handle_new_user()` security definer qui insère les 6 catégories par défaut (À revoir #ff9966 / Inspiration #a78bfa / Muscu #5ee2a0 / Business #5fa8ff / Humour #ffd166 / Idées #ff7eb3, positions 0..5) + trigger `on_auth_user_created after insert on auth.users`.

Tout en `create ... if not exists` / `drop ... if exists` pour l'idempotence.

- [ ] **Step 2: Lancer le harness (doit PASSER)**

Run: `./supabase/test/run_schema_test.sh 2>&1 | grep -E 'TEST|PASSED|FAIL'`
Expected:
```
TEST1 OK: 6 catégories créées par le trigger
TEST2a OK: user A ne voit que sa vidéo
TEST2b OK: user B ne voit que sa vidéo
TEST3 OK: RLS activée sur les 3 tables
ALL SCHEMA TESTS PASSED
```

- [ ] **Step 3: Vérifier l'idempotence (relancer applique 2× sans erreur)**

Run: `./supabase/test/run_schema_test.sh >/dev/null 2>&1 && echo "RUN2 OK"` (chaque run réapplique la migration dans un cluster neuf ; pour tester la double-application, le harness peut être lancé deux fois de suite — ici on valide juste qu'un run complet repasse).
Expected: `RUN2 OK`

- [ ] **Step 4: Écrire `supabase/migrations/README.md`**

Contenu : appliquer via SQL Editor (copier-coller) ou `supabase db push` ; checklist post-migration (3 tables + RLS + 6 catégories au signup) ; note service_role bypass RLS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "Spec 01 T3: migration 0001_init (tables+RLS+trigger) — harness vert"
```

---

## Task 4: Types TS partagés

**Files:**
- Create: `frontend/src/lib/types.ts`

- [ ] **Step 1: Écrire `frontend/src/lib/types.ts`**

Types : `VideoStatus` union, `Category`, `Video`, `IngestStatus`, `ApiToken`, `MediaUrls`, et const `STATUS_STEP: Record<VideoStatus, number>` (analyzing 0, fetching 1, thumbnailing 2, ready 3, error -1). Champs exactement alignés sur le schéma SQL.

- [ ] **Step 2: Vérifier la compilation TS standalone (strict)**

Run: `cd frontend && npx -y typescript@5 tsc --noEmit --strict --skipLibCheck src/lib/types.ts && echo "TSC OK"`
Expected: `TSC OK` (0 erreur)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "Spec 01 T4: types TS partagés (data model + API)"
```

---

## Self-Review
- **Spec coverage :** §1 structure (T1) ✓ · §2 migration tables/RLS/trigger (T2 test, T3 impl) ✓ · §3 .env.example (T1) ✓ · §4 types.ts (T4) ✓ · critères d'acceptation (harness T2/T3 couvre tables+RLS+trigger+isolation ; tsc T4) ✓.
- **Placeholders :** aucun — SQL/harness/types fournis ou décrits précisément avec contenu exact requis.
- **Type consistency :** noms de champs identiques entre `types.ts` (T4) et le schéma SQL (T3) ; `STATUS_STEP` cohérent avec le CHECK status.
