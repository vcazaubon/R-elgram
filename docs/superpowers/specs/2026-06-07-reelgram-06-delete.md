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

### 3. Frontend — DÉJÀ FAIT en Spec 05 (réconciliation)
`api.deleteVideo(id)` (`DELETE {apiUrl}/videos/{id}` avec JWT), `db.deleteVideo`
(délègue à `api.deleteVideo`, pas de delete Supabase direct) et le wiring
PlayerScreen (sheet « Supprimer » → `deleteVideo` → retour library + refresh /
realtime) sont **déjà implémentés** en Spec 05. **Ne pas réimplémenter.** Cette
spec n'a plus qu'à : (a) ajouter l'endpoint backend, (b) vérifier le flux complet
de bout en bout (front existant → backend → fichier purgé).

### 4. Cohérence avec Spec 05
RAS : `db.deleteVideo` appelle déjà `api.deleteVideo` (aucun delete Supabase
direct). Il ne manque que l'endpoint backend (tâche 1).

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
