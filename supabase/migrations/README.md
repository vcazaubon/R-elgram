# Migrations Supabase — Réelgram

Schéma initial : `0001_init.sql` (tables `categories`, `videos`, `api_tokens` + RLS + trigger de signup).

Migrations suivantes (à appliquer dans l'ordre, après `0001`) :

- `0002_add_caption_published_at.sql` — ajoute `videos.caption` (légende brute du reel)
  et `videos.published_at` (date de publication), alimentées à l'ingestion pour des titres
  parlants. Idempotente (`add column if not exists`), colonnes nullables → aucun impact sur
  les lignes existantes.
- `0003_realtime_videos.sql` — ajoute `public.videos` à la publication `supabase_realtime`
  pour que la bibliothèque se mette à jour en live (sinon les cartes d'ingestion restent
  figées jusqu'au relaunch). Idempotente. **Corrige le live sans redéploiement du frontend**
  (la souscription `subscribeVideos` existe déjà côté client).

## Comment appliquer la migration

Deux options, au choix :

### Option A — SQL Editor (copier-coller)

1. Ouvrir le projet dans le dashboard Supabase.
2. Aller dans **SQL Editor** > **New query**.
3. Copier-coller l'intégralité du contenu de `0001_init.sql`, puis **Run**.
4. Répéter pour chaque migration suivante dans l'ordre (`0002_add_caption_published_at.sql`, …).

La migration est idempotente (`create table if not exists`, `drop policy if exists`,
`create or replace function`, `drop trigger if exists`), donc elle peut être ré-exécutée
sans erreur.

### Option B — CLI Supabase

Depuis la racine du repo (avec le projet lié via `supabase link`) :

```bash
supabase db push
```

Cela applique les fichiers du dossier `supabase/migrations/` au projet distant.

## Checklist post-migration

Après application, vérifier dans le dashboard (Table Editor / Authentication) :

- [ ] **3 tables** présentes dans le schéma `public` : `categories`, `videos`, `api_tokens`.
- [ ] **RLS activée** sur les 3 tables (badge "RLS enabled" dans le Table Editor, ou
      `select tablename, rowsecurity from pg_tables where schemaname='public';`).
- [ ] **Policies** « own categories / own videos / own api_tokens » présentes
      (`for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`).
- [ ] **6 catégories par défaut** créées automatiquement au signup d'un nouvel
      utilisateur (trigger `on_auth_user_created` → `handle_new_user`).
      Tester : créer un compte, puis vérifier
      `select count(*) from categories where user_id = '<uid>';` → doit valoir `6`.

## Note importante — backend en `service_role`

Le backend écrit en **`service_role`**, qui **bypasse les RLS**. Les policies définies ici
protègent uniquement les accès faits avec le rôle authentifié (clé `anon` / JWT utilisateur,
côté client). Toute logique d'autorisation côté serveur doit donc être assurée
explicitement par le backend, car la base ne filtrera pas les requêtes `service_role`.

## Tests locaux

Le schéma est testé en Postgres vanilla via un cluster éphémère :

```bash
supabase/test/run_schema_test.sh
```

Le harness stubbe `auth.users` et `auth.uid()`, applique la migration, puis vérifie le
trigger (6 catégories), l'isolation RLS sous un rôle non-propriétaire, et l'activation des
RLS sur les 3 tables.
