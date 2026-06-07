# Spec 06 — Suppression complète (purge fichier + miniature + row)

> Lis `2026-06-07-reelgram-design.md` (§5 contrat d'API). Dépend de Spec 02, 04, 05.
> Cette spec **possède** la fonctionnalité de suppression de bout en bout.

## Objectif
En V1, supprimer une vidéo doit être **complet** : retirer la row Supabase **et**
effacer physiquement le fichier vidéo + la miniature sur le volume local. La
suppression passe donc par un **endpoint backend** (le seul à avoir accès au
volume), pas par un delete Supabase direct.

## Tâches

### 1. Endpoint backend → ajouter dans `backend/app/main.py` (+ helper)
- `DELETE /api/videos/{id}` (auth `resolve_user` = JWT ou token perso) :
  1. Récupère la row `videos` et **vérifie `user_id`** (404 si absente/autre user).
  2. Supprime le fichier `DATA_DIR/<storage_path>` et `DATA_DIR/<thumb_path>`
     s'ils existent (best-effort, ignorer si déjà absents).
  3. Supprime la row via service role.
  4. Si la vidéo est encore en cours d'ingestion (`status != ready`), **annuler/abandonner**
     proprement le job (flag d'annulation) avant de purger, pour éviter qu'un job
     en vol ré-écrive des fichiers après suppression.
  5. Réponse `204 No Content`.
- Garde-fou : empêcher toute traversée de chemin — `storage_path`/`thumb_path`
  sont des chemins relatifs **contrôlés par le backend** ; résoudre via
  `os.path.realpath` et vérifier qu'ils restent sous `DATA_DIR`.

### 2. Contrat d'API (mettre à jour le doc maître §5)
Ajouter la ligne :
| DELETE | `/api/videos/{id}` | JWT ou token | — | `204` — purge row + fichier + miniature |

### 3. Frontend → `frontend/src/lib/api.ts` + écrans
- Ajouter `api.deleteVideo(id)` → `DELETE {API_URL}/api/videos/{id}` avec le JWT.
- **PlayerScreen** (Spec 05) : l'action « Supprimer » (bottom sheet de confirmation
  du design) appelle `api.deleteVideo(id)` au lieu d'un delete Supabase, puis
  retour bibliothèque + refresh de la liste.
- **LibraryScreen** (si une action de suppression rapide existe) : idem via l'API.
- Mettre à jour la liste localement (retirer la vidéo) sans attendre un refetch complet.

### 4. Cohérence avec Spec 05
La fonction `deleteVideo` de `db.ts` (Spec 05) qui faisait un delete Supabase
direct est **remplacée** par l'appel à `api.deleteVideo`. (Spec 05 a été annotée
pour déléguer la suppression à cette spec.)

## Critères d'acceptation
- Supprimer une vidéo depuis le lecteur : la row disparaît **et** le fichier
  `.mp4` + le `.jpg` n'existent plus sous `DATA_DIR` (vérifié sur le volume).
- Supprimer une vidéo en cours d'ingestion l'annule proprement (pas de fichier
  orphelin recréé après coup).
- Un user ne peut pas supprimer la vidéo d'un autre (contrôle `user_id` → 404).
- Tentative de path traversal impossible (chemins confinés à `DATA_DIR`).
- La bibliothèque se met à jour immédiatement après suppression.

## Tests
- Unit : la résolution de chemin rejette tout chemin hors `DATA_DIR`.
- Intégration (mock fs) : `DELETE` supprime fichier+thumb+row ; idempotent si le
  fichier est déjà absent (toujours `204`).
