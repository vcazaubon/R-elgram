# Réelgram Spec 06 — Suppression complète — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD : test rouge → impl verte → commit. Steps en `- [ ]`.

**Goal:** Endpoint backend `DELETE /api/videos/{id}` qui purge complètement une vidéo : row Supabase + fichier vidéo + miniature sur le volume, avec contrôle `user_id`, annulation d'un job d'ingestion en cours, et confinement anti-traversal. Le frontend (api.deleteVideo + wiring PlayerScreen/db) est DÉJÀ fait (Spec 05).

**Architecture:** Greffe sur `_build_videos_router()` (laissé prêt en Spec 02). Réutilise `config.abs_path` (déjà confiné DATA_DIR). Annulation via un registre de tâches d'ingestion exposé par `ingest.py`. Purge best-effort des fichiers (idempotent si déjà absents). 204 No Content.

**Tech Stack:** FastAPI, pytest (mocks supa + tmp filesystem).

---

## File Structure
- `backend/app/ingest.py` — ajouter `cancel_ingest(video_id)` + registre `{video_id: task}`.
- `backend/app/supa.py` — `delete_video(id, user_id)` si absent.
- `backend/app/main.py` — route `DELETE /api/videos/{id}` dans `_build_videos_router`.
- `backend/tests/test_delete.py` — tests.

---

## Task 1: Endpoint DELETE (TDD)
**Files:** Create `backend/tests/test_delete.py`; Modify `backend/app/ingest.py`, `backend/app/supa.py`, `backend/app/main.py`

- [ ] **Step 1: tests (rouge)** `test_delete.py` (TestClient + mocks supa + DATA_DIR=tmp) :
```python
# Fixtures : régler DATA_DIR sur tmp, créer videos/<uid>/<vid>.mp4 et thumbs/<uid>/<vid>.jpg,
# mocker supa.get_video -> row {id, user_id, storage_path, thumb_path, status:'ready'},
# mocker supa.delete_video, fabriquer un JWT valide pour <uid>.
def test_delete_purges_row_file_thumb(client, tmp_files, jwt):
    r = client.delete(f"/api/videos/{VID}", headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 204
    assert not video_file.exists() and not thumb_file.exists()
    assert supa.delete_video.called  # row supprimée
def test_delete_other_user_404(client, jwt_other):
    # get_video filtré user_id -> None pour un autre user
    assert client.delete(f"/api/videos/{VID}", headers=auth(jwt_other)).status_code == 404
def test_delete_idempotent_missing_files(client, jwt):
    # supprimer les fichiers avant l'appel -> toujours 204
    assert client.delete(...).status_code == 204
def test_delete_requires_auth(client):
    assert client.delete(f"/api/videos/{VID}").status_code == 401
def test_cancel_ingest_called_when_not_ready(client, jwt, monkeypatch):
    # row status='fetching' -> ingest.cancel_ingest(VID) appelé avant purge
```
Plus un test unitaire `ingest.cancel_ingest` : enregistre une fausse task annulable, `cancel_ingest(vid)` appelle `.cancel()` et la retire du registre ; no-op si absent.

- [ ] **Step 2: run rouge** `cd backend && .venv/bin/pytest tests/test_delete.py -q` → FAIL.
- [ ] **Step 3: ingest.py** — registre module `_ingest_tasks: dict[str, asyncio.Task]` ; à la planification d'un `run_ingest`, enregistrer `{video_id: task}` et le retirer en fin (done callback) ; `cancel_ingest(video_id)` : si présent, `task.cancel()` + retrait (no-op sinon). `run_ingest` : tolérer `CancelledError` (ne pas réécrire de fichier après annulation).
- [ ] **Step 4: supa.py** — `delete_video(id, user_id)` (delete filtré user_id) si pas déjà présent.
- [ ] **Step 5: main.py** — dans `_build_videos_router`, ajouter `DELETE /api/videos/{video_id}` (dépendance `resolve_user`) :
  1. `row = supa.get_video(video_id, user_id=current_user)` ; si None → 404.
  2. si `row['status'] != 'ready'` → `ingest.cancel_ingest(video_id)`.
  3. purger fichiers via `settings.abs_path(row['storage_path'])` et `abs_path(row['thumb_path'])` si non-null (try/except FileNotFoundError → ignore ; `abs_path` confine déjà à DATA_DIR).
  4. `supa.delete_video(video_id, current_user)`.
  5. `Response(status_code=204)`.
- [ ] **Step 6: run vert** `.venv/bin/pytest -q` (toute la suite, pas de régression) → PASS ; `.venv/bin/python -c "import app.main"` OK ; vérifier la route : `DELETE /api/videos/{video_id}` montée.
- [ ] **Step 7: commit** `git add backend && git commit -m "Spec 06: DELETE /api/videos/{id} purge complète (row+fichier+miniature)"`

---

## Self-Review
- **Spec coverage :** endpoint DELETE purge row+fichier+miniature (T1) ✓ · contrôle user_id→404 (T1) ✓ · annulation job en cours (T1, ingest.cancel_ingest) ✓ · anti-traversal via abs_path (réutilisé) ✓ · idempotent fichiers absents→204 (T1) ✓ · frontend déjà fait Spec 05 (rien à faire) ✓.
- **Placeholders :** tests fournis ; impl décrite étape par étape. Pas de TODO.
- **Type consistency :** `get_video(id, user_id=)` / `delete_video(id, user_id)` cohérents avec supa.py existant ; `cancel_ingest(video_id)` nouveau, registre keyé par video_id.
