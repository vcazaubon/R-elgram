# Publications à images (photos & carrousels) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accepter les posts Instagram à images (photo seule + carrousels d'images, avec visualiseur swipe), aujourd'hui en erreur.

**Architecture :** `run_ingest` classe le post en tête de pipeline. URL `/reel/`·`/tv/` → flux vidéo actuel (yt-dlp, inchangé). URL `/p/` → extraction **gallery-dl** (`-j`, sans téléchargement, mockable) ; si ≥1 slide image → on télécharge les images via **httpx**, on ignore les slides vidéo, et on enregistre un modèle léger (`media_type='image'` + `media` jsonb). Sinon (post 100 % vidéo, ou gallery-dl en échec) → repli sur le flux vidéo. Le service média gagne une route `slide/{i}` signée ; le front route les posts image vers un nouveau `GalleryScreen` (swipe, image entière).

**Tech Stack :** Python 3.13 / FastAPI / yt-dlp / **gallery-dl** / httpx / ffmpeg (backend) · PostgreSQL/Supabase (migration SQL + harness `pg_virtualenv`) · React 18 / TypeScript 5 / Vite / vitest (frontend).

**Conventions vérifiées :**
- pytest : `cd backend && .venv/bin/python -m pytest` (toujours depuis `backend/` ; `asyncio_mode=auto`). Lancer pytest depuis la racine donne de faux échecs d'import.
- Binaires externes isolés dans des helpers privés **mockés** en test (cf. `_download`, `_thumbnail`).
- Le front lit `select('*')` (db.ts) → les nouvelles colonnes arrivent sans mapping.
- Le token média est lié à `(video_id, user_id, exp)`, pas à un chemin → un seul token couvre toutes les slides.

---

## File Structure

**Backend**
- Create `supabase/migrations/0004_media_carousel.sql` — colonnes `media_type` + `media`.
- Modify `supabase/test/schema_test.sql`, `supabase/test/run_schema_test.sh` — applique 0004 + TEST 4.
- Modify `backend/app/config.py` — helper `rel_slide_path`.
- Modify `backend/app/ingest.py` — classification + branche image (extraction gallery-dl, download httpx, métadonnées).
- Modify `backend/app/models.py` — `MediaUrls` (media_type + slides).
- Modify `backend/app/main.py` — route `slide/{i}`, `media-url` enrichi, purge des slides au DELETE.
- Modify `backend/requirements.txt` — `gallery-dl`.
- Test : `backend/tests/test_ingest.py`, `backend/tests/test_media_slides.py` (create), `backend/tests/test_delete.py`.

**Frontend**
- Modify `frontend/src/lib/types.ts` — `Video.media_type`/`media`, `MediaUrls` + `slides`/`media_type`, type `MediaSlide`.
- Modify `frontend/src/components/Icons.tsx` — icône `carousel`.
- Modify `frontend/src/components/VideoCard.tsx` — badge compteur, pas de play sur image.
- Create `frontend/src/screens/MediaActionSheet.tsx` — sheet renommer/catégorie/supprimer + `ActionBtn` (extrait de PlayerScreen, partagé).
- Modify `frontend/src/screens/PlayerScreen.tsx` — importe le sheet partagé.
- Create `frontend/src/screens/GalleryScreen.tsx` — visualiseur swipe (image entière).
- Create `frontend/src/screens/galleryLogic.ts` + `galleryLogic.test.ts` — index actif depuis le scroll (pur, testé).
- Modify `frontend/src/App.tsx` — route image → GalleryScreen, résout les `slides`.

**Docs/Déploiement**
- Modify `README.md` — note gallery-dl + cookies (même fichier).

---

## Task 1 : Migration data model + harness schéma

**Files:**
- Create: `supabase/migrations/0004_media_carousel.sql`
- Modify: `supabase/test/schema_test.sql`
- Modify: `supabase/test/run_schema_test.sh`

- [ ] **Step 1 : Écrire la migration**

Create `supabase/migrations/0004_media_carousel.sql` :

```sql
-- Réelgram — publications à images (photos & carrousels)
-- Spec: docs/superpowers/specs/2026-06-09-image-carousels-design.md
-- Rétro-compatible : les lignes existantes deviennent media_type='video', media=null.
alter table public.videos
  add column if not exists media_type text not null default 'video'
    check (media_type in ('video','image'));
alter table public.videos
  add column if not exists media jsonb;   -- null pour une vidéo ; tableau ordonné de slides pour un post image
```

- [ ] **Step 2 : Brancher la migration dans le harness**

In `supabase/test/run_schema_test.sh`, replace the body so 0004 is applied too:

```bash
#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATION="$HERE/../migrations/0001_init.sql"
MIGRATION4="$HERE/../migrations/0004_media_carousel.sql"
sudo pg_virtualenv bash -c "
  psql -v ON_ERROR_STOP=1 -v migration='$MIGRATION' -v migration4='$MIGRATION4' -f '$HERE/schema_test.sql'
"
```

In `supabase/test/schema_test.sql`, apply 0004 right after the core migration. Find:

```sql
-- Applique la migration réelle
\i :migration
```

and change to:

```sql
-- Applique la migration réelle
\i :migration
-- Puis la migration des publications à images (colonnes media_type + media)
\i :migration4
```

- [ ] **Step 3 : Ajouter TEST 4 (defaults + check + post image)**

In `supabase/test/schema_test.sql`, just before the final line `select 'ALL SCHEMA TESTS PASSED' as result;`, insert:

```sql
-- TEST 4 : media_type + media (publications à images)
do $$
declare uid_c uuid; vid_c uuid; mt text; md jsonb;
begin
  insert into auth.users (email) values ('c@test.io') returning id into uid_c;
  insert into public.videos (user_id, source_url)
    values (uid_c, 'https://instagram.com/p/c')
    returning id, media_type, media into vid_c, mt, md;
  if mt <> 'video' then
    raise exception 'MEDIA FAIL: default media_type attendu video, obtenu %', mt;
  end if;
  if md is not null then
    raise exception 'MEDIA FAIL: default media attendu null';
  end if;
  -- la contrainte CHECK rejette une valeur invalide
  begin
    update public.videos set media_type = 'audio' where id = vid_c;
    raise exception 'MEDIA FAIL: media_type=audio aurait du etre rejete';
  exception when check_violation then null;
  end;
  -- un post image valide est accepté
  update public.videos
     set media_type = 'image',
         media = '[{"i":0,"path":"videos/x/0.jpg","w":1080,"h":1350}]'::jsonb
   where id = vid_c;
  raise notice 'TEST4 OK: media_type + media';
end $$;
```

- [ ] **Step 4 : Lancer le harness**

Run: `bash supabase/test/run_schema_test.sh`
Expected: les notices `TEST1 OK`…`TEST4 OK` puis `ALL SCHEMA TESTS PASSED`. (Si `pg_virtualenv` manque : `sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib postgresql-common`.)

- [ ] **Step 5 : Commit**

```bash
git add supabase/migrations/0004_media_carousel.sql supabase/test/schema_test.sql supabase/test/run_schema_test.sh
git commit -m "feat(db): media_type + media jsonb pour les publications à images"
```

---

## Task 2 : Extraction gallery-dl (classification du post)

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/ingest.py`
- Test: `backend/tests/test_ingest.py`

- [ ] **Step 1 : Écrire les tests d'extraction**

Append to `backend/tests/test_ingest.py` :

```python
# --- gallery-dl : extraction + classification d'un post /p/ ------------------

def test_extract_post_parses_sidecar(monkeypatch):
    import json as _json
    payload = [
        [2, {"username": "studio.archi"}],  # Message.Directory (ignoré)
        [3, "https://cdn/0.jpg", {"extension": "jpg", "width": 1080, "height": 1350,
                                  "username": "studio.archi", "fullname": "Studio",
                                  "description": "5 idées déco salon\n#deco",
                                  "date": "2026-05-12 08:30:00"}],
        [3, "https://cdn/1.jpg", {"extension": "jpg", "width": 1080, "height": 1080}],
        [3, "https://cdn/2.mp4", {"extension": "mp4", "width": 720, "height": 1280}],
    ]

    def fake_run(cmd, **kwargs):
        assert cmd[0] == "gallery-dl"
        assert "-j" in cmd
        return types.SimpleNamespace(stdout=_json.dumps(payload).encode("utf-8"))

    monkeypatch.setattr(ingest.subprocess, "run", fake_run)
    post = ingest._extract_post("https://instagram.com/p/abc/", None)

    assert [s["kind"] for s in post["slides"]] == ["image", "image", "video"]
    assert post["slides"][0]["url"] == "https://cdn/0.jpg"
    assert post["slides"][0]["ext"] == "jpg"
    assert post["slides"][0]["width"] == 1080
    assert post["meta"]["username"] == "studio.archi"


def test_extract_post_passes_existing_cookiefile(monkeypatch, tmp_path):
    cookie = tmp_path / "cookies.txt"
    cookie.write_text("# Netscape HTTP Cookie File\n")
    seen = {}

    def fake_run(cmd, **kwargs):
        seen["cmd"] = cmd
        return types.SimpleNamespace(stdout=b"[]")

    monkeypatch.setattr(ingest.subprocess, "run", fake_run)
    ingest._extract_post("https://instagram.com/p/abc/", str(cookie))

    assert "--cookies" in seen["cmd"]
    assert str(cookie) in seen["cmd"]


def test_looks_like_image_post_url():
    assert ingest._looks_like_image_post_url("https://instagram.com/p/abc/") is True
    assert ingest._looks_like_image_post_url("https://www.instagram.com/reel/abc/") is False
    assert ingest._looks_like_image_post_url("https://instagram.com/reels/abc/") is False
    assert ingest._looks_like_image_post_url("https://instagram.com/tv/abc/") is False
```

- [ ] **Step 2 : Lancer — échec attendu**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ingest.py -k "extract_post or looks_like_image" -q`
Expected: FAIL (`AttributeError: module 'app.ingest' has no attribute '_extract_post'`).

- [ ] **Step 3 : Implémenter le helper de chemin de slide**

In `backend/app/config.py`, after `rel_thumb_path` (around line 79), add:

```python
    def rel_slide_path(self, user_id: str, video_id: str, i: int, ext: str = "jpg") -> str:
        return f"videos/{user_id}/{video_id}/{i}.{ext}"
```

- [ ] **Step 4 : Implémenter l'extraction gallery-dl**

In `backend/app/ingest.py`, add after `_download` (after the yt-dlp helper, ~line 84). Also add `from urllib.parse import urlparse` to the imports at the top.

```python
# Extensions considérées comme des images (le reste = vidéo, on les ignore).
_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "heic"}


def _looks_like_image_post_url(url: str) -> bool:
    """True si l'URL PEUT porter des images (post ``/p/``).

    Les Reels / IGTV sont toujours des vidéos → on saute gallery-dl pour eux.
    Tout le reste (``/p/`` ou forme inconnue) est tenté en extraction image,
    avec repli vidéo si aucune image n'en sort (cf. ``run_ingest``).
    """
    try:
        path = (urlparse(url).path or "").lower()
    except Exception:
        return False
    return not ("/reel/" in path or "/reels/" in path or "/tv/" in path)


def _extract_post(url: str, cookies: Optional[str]) -> dict:
    """Classe un post Instagram via ``gallery-dl -j`` (extraction SANS download).

    Renvoie ``{"slides": [{"url","ext","kind","width","height"}, …], "meta": {…}}``.
    ``gallery-dl -j`` sérialise une liste de messages ; chaque message
    ``[3, url, metadata]`` (``Message.Url``) décrit un média. ``kind`` vaut
    ``"image"`` quand l'extension est dans :data:`_IMAGE_EXTS`, sinon ``"video"``.
    Helper isolé (subprocess) pour être mocké en test, comme yt-dlp/ffmpeg.
    """
    import json

    cmd = ["gallery-dl", "-j"]
    if cookies and Path(cookies).exists():
        cmd += ["--cookies", cookies]
    cmd.append(url)
    out = subprocess.run(
        cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    ).stdout
    data = json.loads(out.decode("utf-8", "ignore") or "[]")

    slides: list[dict] = []
    meta: dict = {}
    for item in data:
        if not (isinstance(item, list) and len(item) >= 3 and item[0] == 3):
            continue
        media_url, kw = item[1], item[2]
        if not isinstance(kw, dict):
            kw = {}
        if not meta:
            meta = kw
        ext = str(kw.get("extension", "")).lower()
        kind = "image" if ext in _IMAGE_EXTS else "video"
        slides.append({
            "url": media_url,
            "ext": ext or "jpg",
            "kind": kind,
            "width": kw.get("width"),
            "height": kw.get("height"),
        })
    return {"slides": slides, "meta": meta}
```

- [ ] **Step 5 : Lancer — succès attendu**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ingest.py -k "extract_post or looks_like_image" -q`
Expected: PASS (3 tests).

- [ ] **Step 6 : Commit**

```bash
git add backend/app/config.py backend/app/ingest.py backend/tests/test_ingest.py
git commit -m "feat(ingest): extraction gallery-dl + classification d'un post /p/"
```

---

## Task 3 : Helpers branche image (download, métadonnées, vignette)

**Files:**
- Modify: `backend/app/ingest.py`
- Test: `backend/tests/test_ingest.py`

- [ ] **Step 1 : Écrire les tests**

Append to `backend/tests/test_ingest.py` :

```python
# --- branche image : download httpx + métadonnées + vignette image -----------

def _fake_httpx(capture):
    """Module httpx de remplacement : capture l'URL et renvoie des octets."""
    mod = types.ModuleType("httpx")

    class FakeResp:
        def __init__(self, content):
            self.content = content

        def raise_for_status(self):
            return None

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def get(self, url):
            capture["url"] = url
            return FakeResp(b"IMGBYTES")

    mod.Client = FakeClient
    return mod


def test_download_image_writes_file(monkeypatch, tmp_path):
    cap = {}
    monkeypatch.setitem(sys.modules, "httpx", _fake_httpx(cap))
    dest = tmp_path / "videos/u/v/0.jpg"

    ingest._download_image("https://cdn/0.jpg", dest)

    assert dest.read_bytes() == b"IMGBYTES"
    assert cap["url"] == "https://cdn/0.jpg"


def test_thumbnail_image_has_no_seek(monkeypatch, tmp_path):
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        Path(cmd[-1]).write_bytes(b"\xff\xd8jpeg")
        return types.SimpleNamespace(returncode=0)

    monkeypatch.setattr(ingest.subprocess, "run", fake_run)
    src = tmp_path / "0.jpg"
    src.write_bytes(b"img")

    ingest._thumbnail(src, tmp_path / "t.jpg", seek=False)
    assert "-ss" not in captured["cmd"]

    ingest._thumbnail(src, tmp_path / "t2.jpg")  # défaut vidéo : seek
    assert "-ss" in captured["cmd"]


def test_post_meta_to_info_maps_keys():
    meta = {"username": "studio.archi", "fullname": "Studio",
            "description": "Légende ici"}
    info = ingest._post_meta_to_info(meta)
    assert info["uploader_id"] == "studio.archi"
    assert info["uploader"] == "Studio"
    assert info["description"] == "Légende ici"
    assert info["title"] == ""


def test_published_at_from_gallery():
    assert ingest._published_at_from_gallery({"date": "2026-05-12 08:30:00"}).startswith("2026-05-12")
    assert ingest._published_at_from_gallery({}) is None
    assert ingest._published_at_from_gallery({"date": "pas-une-date"}) is None
```

- [ ] **Step 2 : Lancer — échec attendu**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ingest.py -k "download_image or thumbnail_image or post_meta or published_at_from_gallery" -q`
Expected: FAIL (`_download_image` / `_post_meta_to_info` / `_published_at_from_gallery` absents ; `_thumbnail` n'accepte pas `seek`).

- [ ] **Step 3 : Modifier `_thumbnail` (paramètre `seek`)**

In `backend/app/ingest.py`, replace `_thumbnail` (around lines 130-141) :

```python
def _thumbnail(src: Path, dst: Path, seek: bool = True) -> None:
    """Extrait une frame de ``src`` vers ``dst`` (jpeg 640px) via ffmpeg.

    ``seek=True`` (défaut, vidéo) saute ~1 s avant la capture ; ``seek=False``
    (image fixe) capture l'unique frame sans seek (sinon ffmpeg échoue).
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y"]
    if seek:
        cmd += ["-ss", "1"]
    cmd += ["-i", str(src), "-frames:v", "1", "-vf", "scale=640:-1", str(dst)]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
```

- [ ] **Step 4 : Ajouter les helpers image**

In `backend/app/ingest.py`, add after `_extract_post` :

```python
def _download_image(url: str, dest: Path) -> None:
    """Télécharge une image (slide de carrousel) vers ``dest`` via httpx.

    Les URLs d'images du CDN Instagram sont publiques (signées en query) →
    pas besoin de cookies ici. Helper isolé pour être mocké en test.
    """
    import httpx

    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=30) as client:
        resp = client.get(url)
        resp.raise_for_status()
        dest.write_bytes(resp.content)


def _post_meta_to_info(meta: dict) -> dict:
    """Adapte les métadonnées gallery-dl au format ``info`` (yt-dlp) attendu par
    les extracteurs de titre/auteur/légende existants (DRY)."""
    return {
        "description": meta.get("description") or "",
        "uploader_id": meta.get("username"),
        "uploader": meta.get("fullname"),
        "title": "",
    }


def _published_at_from_gallery(meta: dict) -> Optional[str]:
    """Convertit la date gallery-dl (``"YYYY-MM-DD HH:MM:SS"``) en ISO-8601 UTC.

    Naïf → traité comme UTC. Toute valeur illisible → None.
    """
    raw = meta.get("date")
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        dt = datetime.fromisoformat(raw.replace(" ", "T"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()
```

- [ ] **Step 5 : Lancer — succès attendu**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ingest.py -k "download_image or thumbnail_image or post_meta or published_at_from_gallery" -q`
Expected: PASS (5 tests).

- [ ] **Step 6 : Commit**

```bash
git add backend/app/ingest.py backend/tests/test_ingest.py
git commit -m "feat(ingest): helpers branche image (download httpx, vignette image, métadonnées)"
```

---

## Task 4 : `run_ingest` — classification + branche image + repli vidéo

**Files:**
- Modify: `backend/app/ingest.py`
- Test: `backend/tests/test_ingest.py`

- [ ] **Step 1 : Réorienter les 2 anciens tests `/p/` vers `/reel/`**

Ces tests valident le **flux vidéo** ; avec la classification, une URL `/p/` part désormais en extraction image. Les rendre déterministes (flux vidéo) en changeant leur URL. In `backend/tests/test_ingest.py` :

- `test_run_ingest_title_fallback` : remplacer `"https://instagram.com/p/xyz/"` par `"https://instagram.com/reel/xyz/"`.
- `test_run_ingest_title_truncated` : remplacer `"https://instagram.com/p/xyz/"` par `"https://instagram.com/reel/xyz/"`.

- [ ] **Step 2 : Écrire les tests de la branche image + repli**

Append to `backend/tests/test_ingest.py` :

```python
async def test_run_ingest_image_carousel(monkeypatch, tmp_path):
    _set_env(monkeypatch, tmp_path)
    rec = Recorder()
    monkeypatch.setattr(supa, "update_video", rec.update_video)

    def fake_extract(url, cookies):
        return {
            "slides": [
                {"url": "https://cdn/0.jpg", "ext": "jpg", "kind": "image", "width": 1080, "height": 1350},
                {"url": "https://cdn/1.jpg", "ext": "jpg", "kind": "image", "width": 1080, "height": 1080},
                {"url": "https://cdn/2.mp4", "ext": "mp4", "kind": "video", "width": 720, "height": 1280},
            ],
            "meta": {"username": "studio.archi", "fullname": "Studio",
                     "description": "5 idées déco salon\n\n#deco #home",
                     "date": "2026-05-12 08:30:00"},
        }

    def fake_dl_image(url, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"IMG:" + url.encode())

    def fake_thumbnail(src, dst, seek=True):
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(b"\xff\xd8jpeg")

    monkeypatch.setattr(ingest, "_extract_post", fake_extract)
    monkeypatch.setattr(ingest, "_download_image", fake_dl_image)
    monkeypatch.setattr(ingest, "_thumbnail", fake_thumbnail)
    monkeypatch.setattr(ingest, "_dominant_color", lambda src: "#abcdef")

    await ingest.run_ingest("vid-img", "user-7", "https://www.instagram.com/p/abc/")

    assert rec.statuses == ["fetching", "thumbnailing", "ready"]
    final = rec.final
    assert final["status"] == "ready"
    assert final["media_type"] == "image"
    assert len(final["media"]) == 2  # la slide vidéo est ignorée
    assert final["media"][0] == {"i": 0, "path": "videos/user-7/vid-img/0.jpg", "w": 1080, "h": 1350}
    assert final["media"][1] == {"i": 1, "path": "videos/user-7/vid-img/1.jpg", "w": 1080, "h": 1080}
    assert final["storage_path"] == "videos/user-7/vid-img/0.jpg"
    assert final["thumb_path"] == "thumbs/user-7/vid-img.jpg"
    assert final["title"] == "5 idées déco salon"
    assert final["author"] == "@studio.archi"
    assert final["duration_seconds"] is None
    assert final["published_at"].startswith("2026-05-12")
    assert final["thumb_color"] == "#abcdef"
    assert (tmp_path / "videos/user-7/vid-img/0.jpg").exists()
    assert (tmp_path / "videos/user-7/vid-img/1.jpg").exists()
    assert not (tmp_path / "videos/user-7/vid-img/2.mp4").exists()


async def test_run_ingest_p_url_pure_video_falls_back(monkeypatch, tmp_path):
    _set_env(monkeypatch, tmp_path)
    rec = Recorder()
    monkeypatch.setattr(supa, "update_video", rec.update_video)

    monkeypatch.setattr(ingest, "_extract_post",
                        lambda url, cookies: {"slides": [{"url": "x", "ext": "mp4", "kind": "video"}], "meta": {}})

    def fake_download(url, dest, cookies, max_mb):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"v")
        return {"title": "t", "duration": 5}

    monkeypatch.setattr(ingest, "_download", fake_download)
    monkeypatch.setattr(ingest, "_thumbnail", _write_thumb)
    monkeypatch.setattr(ingest, "_dominant_color", lambda src: "#a78bfa")
    monkeypatch.setattr(ingest, "_ensure_ios_compatible", lambda p: None)

    await ingest.run_ingest("vid-pv", "user-7", "https://instagram.com/p/onlyvideo/")

    final = rec.final
    assert final["status"] == "ready"
    assert final.get("media_type") in (None, "video")  # pas de branche image
    assert final["storage_path"] == "videos/user-7/vid-pv.mp4"


async def test_run_ingest_gallerydl_failure_falls_back(monkeypatch, tmp_path):
    _set_env(monkeypatch, tmp_path)
    rec = Recorder()
    monkeypatch.setattr(supa, "update_video", rec.update_video)

    def boom(url, cookies):
        raise RuntimeError("gallery-dl absent")

    def fake_download(url, dest, cookies, max_mb):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"v")
        return {"title": "t", "duration": 5}

    monkeypatch.setattr(ingest, "_extract_post", boom)
    monkeypatch.setattr(ingest, "_download", fake_download)
    monkeypatch.setattr(ingest, "_thumbnail", _write_thumb)
    monkeypatch.setattr(ingest, "_dominant_color", lambda src: "#a78bfa")
    monkeypatch.setattr(ingest, "_ensure_ios_compatible", lambda p: None)

    await ingest.run_ingest("vid-fb", "user-7", "https://instagram.com/p/x/")

    final = rec.final
    assert final["status"] == "ready"
    assert final["storage_path"] == "videos/user-7/vid-fb.mp4"
```

- [ ] **Step 3 : Lancer — échec attendu**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ingest.py -k "image_carousel or falls_back" -q`
Expected: FAIL (la branche image n'existe pas → reste sur le flux vidéo / KeyError `media_type`).

- [ ] **Step 4 : Refactorer `run_ingest`**

In `backend/app/ingest.py`, replace the whole `run_ingest` (from `async def run_ingest` to the end of the file) with the classification + two branches:

```python
async def run_ingest(video_id: str, user_id: str, url: str) -> None:
    """Pipeline complet pour une ligne ``videos`` déjà créée.

    Ne lève jamais : tout échec est enregistré en ``status='error'``. Classe le
    post puis bifurque : branche **image** (gallery-dl + httpx) si l'URL peut
    porter des images ET qu'au moins une slide image en sort ; sinon branche
    **vidéo** (yt-dlp, inchangée), qui sert aussi de repli.
    """
    settings = get_settings()
    try:
        supa.update_video(video_id, {"status": "fetching"})

        if _looks_like_image_post_url(url):
            try:
                post = await asyncio.to_thread(_extract_post, url, settings.ig_cookies_file)
                images = [s for s in post["slides"] if s["kind"] == "image"]
            except Exception:  # noqa: BLE001 — extraction KO → repli vidéo
                images = []
                post = {"meta": {}}
            if images:
                await _finish_image_post(video_id, user_id, images, post["meta"], settings)
                return

        await _finish_video_post(video_id, user_id, url, settings)
    except asyncio.CancelledError:
        # Annulé par DELETE (Spec 06) : on s'arrête sans réécrire fichier ni statut.
        raise
    except Exception as exc:  # noqa: BLE001 — tout échec -> status error, pas de crash
        message = str(exc) or exc.__class__.__name__
        try:
            supa.update_video(video_id, {"status": "error", "error": message[:500]})
        except Exception:
            pass


async def _finish_video_post(video_id: str, user_id: str, url: str, settings) -> None:
    """Branche vidéo : yt-dlp -> normalisation iOS -> vignette -> ready (inchangée)."""
    rel_video = settings.rel_video_path(user_id, video_id)
    rel_thumb = settings.rel_thumb_path(user_id, video_id)
    video_path = settings.abs_path(rel_video)
    thumb_path = settings.abs_path(rel_thumb)

    info = await asyncio.to_thread(
        _download, url, video_path, settings.ig_cookies_file, settings.max_video_mb
    )
    if not video_path.exists() or video_path.stat().st_size == 0:
        raise RuntimeError("aucun fichier téléchargé (taille max dépassée ou vidéo indisponible)")

    await asyncio.to_thread(_ensure_ios_compatible, video_path)

    supa.update_video(video_id, {"status": "thumbnailing"})
    await asyncio.to_thread(_thumbnail, video_path, thumb_path)
    color = await asyncio.to_thread(_dominant_color, video_path)

    supa.update_video(
        video_id,
        {
            "status": "ready",
            "storage_path": rel_video,
            "thumb_path": rel_thumb,
            "title": _resolve_title(info),
            "author": _extract_author(info),
            "duration_seconds": _extract_duration(info),
            "caption": _extract_caption(info),
            "published_at": _extract_published_at(info),
            "thumb_color": color,
        },
    )


async def _finish_image_post(video_id: str, user_id: str, images: list, post_meta: dict, settings) -> None:
    """Branche image : télécharge les slides, vignette/couleur sur la slide 0,
    puis enregistre ``media_type='image'`` + le tableau ``media``."""
    media: list[dict] = []
    for i, img in enumerate(images):
        ext = (img.get("ext") or "jpg").lower()
        rel = settings.rel_slide_path(user_id, video_id, i, ext)
        dest = settings.abs_path(rel)
        await asyncio.to_thread(_download_image, img["url"], dest)
        if not dest.exists() or dest.stat().st_size == 0:
            raise RuntimeError("slide image vide ou indisponible")
        media.append({"i": i, "path": rel, "w": img.get("width"), "h": img.get("height")})

    cover = settings.abs_path(media[0]["path"])
    rel_thumb = settings.rel_thumb_path(user_id, video_id)
    thumb_path = settings.abs_path(rel_thumb)

    supa.update_video(video_id, {"status": "thumbnailing"})
    await asyncio.to_thread(_thumbnail, cover, thumb_path, False)
    color = await asyncio.to_thread(_dominant_color, cover)

    info = _post_meta_to_info(post_meta)
    supa.update_video(
        video_id,
        {
            "status": "ready",
            "media_type": "image",
            "media": media,
            "storage_path": media[0]["path"],
            "thumb_path": rel_thumb,
            "title": _resolve_title(info),
            "author": _extract_author(info),
            "duration_seconds": None,
            "caption": _extract_caption(info),
            "published_at": _published_at_from_gallery(post_meta),
            "thumb_color": color,
        },
    )
```

- [ ] **Step 5 : Lancer toute la suite ingest**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ingest.py -q`
Expected: PASS (tous, anciens + nouveaux).

- [ ] **Step 6 : Commit**

```bash
git add backend/app/ingest.py backend/tests/test_ingest.py
git commit -m "feat(ingest): run_ingest classe le post et gère la branche image"
```

---

## Task 5 : Service média — route `slide/{i}`, `media-url` enrichi, purge DELETE

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_media_slides.py`
- Test: `backend/tests/test_delete.py`

- [ ] **Step 1 : Écrire les tests média (slides)**

Create `backend/tests/test_media_slides.py` :

```python
"""media-url enrichi + route slide/{i} (publications à images)."""
import time

import jwt
from fastapi.testclient import TestClient

JWT_SECRET = "jwt-secret-für-tests-abcdefghijklmnop"
MEDIA_SECRET = "media-secret-für-tests-1234567890abc"


def _env(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("MEDIA_TOKEN_SECRET", MEDIA_SECRET)
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app.config import get_settings
    get_settings.cache_clear()


def _client():
    import app.main as main
    return TestClient(main.app)


def _auth(sub="user-1"):
    tok = jwt.encode({"sub": sub, "aud": "authenticated", "exp": int(time.time()) + 60},
                     JWT_SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {tok}"}


def _image_row():
    return {
        "id": "vid-img", "user_id": "user-1", "status": "ready",
        "media_type": "image",
        "media": [{"i": 0, "path": "videos/user-1/vid-img/0.jpg"},
                  {"i": 1, "path": "videos/user-1/vid-img/1.jpg"}],
        "storage_path": "videos/user-1/vid-img/0.jpg",
        "thumb_path": "thumbs/user-1/vid-img.jpg",
    }


def test_media_url_image_returns_slides(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path)
    from app import supa
    monkeypatch.setattr(supa, "get_video",
                        lambda vid, user_id=None: dict(_image_row()) if user_id in (None, "user-1") else None)
    r = _client().get("/api/videos/vid-img/media-url", headers=_auth())
    assert r.status_code == 200
    j = r.json()
    assert j["media_type"] == "image"
    assert len(j["slides"]) == 2
    assert "/api/videos/vid-img/slide/0?t=" in j["slides"][0]
    assert j["thumb_url"]


def test_media_url_video_returns_stream(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path)
    from app import supa
    row = {"id": "vid-v", "user_id": "user-1", "status": "ready", "media_type": "video",
           "media": None, "storage_path": "videos/user-1/vid-v.mp4", "thumb_path": "thumbs/user-1/vid-v.jpg"}
    monkeypatch.setattr(supa, "get_video",
                        lambda vid, user_id=None: dict(row) if user_id in (None, "user-1") else None)
    r = _client().get("/api/videos/vid-v/media-url", headers=_auth())
    assert r.status_code == 200
    j = r.json()
    assert j["media_type"] == "video"
    assert "/api/videos/vid-v/stream?t=" in j["stream_url"]


def test_slide_serves_image_bytes(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path)
    from app import supa, media
    from app.config import get_settings
    p = get_settings().abs_path("videos/user-1/vid-img/0.jpg")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"IMG0")
    monkeypatch.setattr(supa, "get_video",
                        lambda vid, user_id=None: dict(_image_row()) if user_id in (None, "user-1") else None)
    tok = media.sign_media_token("vid-img", "user-1")
    r = _client().get(f"/api/videos/vid-img/slide/0?t={tok}")
    assert r.status_code == 200
    assert r.content == b"IMG0"


def test_slide_out_of_range_404(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path)
    from app import supa, media
    monkeypatch.setattr(supa, "get_video",
                        lambda vid, user_id=None: dict(_image_row()) if user_id in (None, "user-1") else None)
    tok = media.sign_media_token("vid-img", "user-1")
    r = _client().get(f"/api/videos/vid-img/slide/9?t={tok}")
    assert r.status_code == 404


def test_slide_bad_token_403(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path)
    from app import supa
    monkeypatch.setattr(supa, "get_video",
                        lambda vid, user_id=None: dict(_image_row()) if user_id in (None, "user-1") else None)
    r = _client().get("/api/videos/vid-img/slide/0?t=not.a.valid.token")
    assert r.status_code == 403
```

- [ ] **Step 2 : Lancer — échec attendu**

Run: `cd backend && .venv/bin/python -m pytest tests/test_media_slides.py -q`
Expected: FAIL (route `slide` absente ; `media-url` ne renvoie pas `media_type`/`slides`).

- [ ] **Step 3 : Étendre le modèle `MediaUrls`**

In `backend/app/models.py`, replace the `MediaUrls` class :

```python
class MediaUrls(BaseModel):
    media_type: str = "video"
    stream_url: Optional[str] = None   # vidéo uniquement
    slides: Optional[list[str]] = None  # post image : URLs signées par slide
    thumb_url: str
```

- [ ] **Step 4 : Enrichir `media-url` + ajouter la route `slide`**

In `backend/app/main.py`, replace the `media_url` route (lines ~123-135) :

```python
    @router.get("/{video_id}/media-url", response_model=MediaUrls)
    async def media_url(
        video_id: str,
        user_id: str = Depends(auth.resolve_user_jwt_only),
    ):
        row = supa.get_video(video_id, user_id=user_id)
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        token = media.sign_media_token(video_id, user_id, ttl=MEDIA_TTL)
        thumb_url = f"/api/videos/{video_id}/thumb?t={token}"
        if row.get("media_type") == "image":
            slides = [
                f"/api/videos/{video_id}/slide/{m['i']}?t={token}"
                for m in (row.get("media") or [])
            ]
            return MediaUrls(media_type="image", slides=slides, thumb_url=thumb_url)
        return MediaUrls(
            media_type="video",
            stream_url=f"/api/videos/{video_id}/stream?t={token}",
            thumb_url=thumb_url,
        )
```

Then add the `slide` route right after the `thumb` route (after line ~165, before `delete_video`) :

```python
    @router.get("/{video_id}/slide/{i}")
    async def slide(
        video_id: str,
        i: int,
        request: Request,
        t: str = Query(...),
    ):
        owner_id = _video_id_from_media_token(video_id, t)
        row = supa.get_video(video_id, user_id=owner_id)
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        media_list = row.get("media") or []
        if i < 0 or i >= len(media_list):
            raise HTTPException(status_code=404, detail="Slide not found")
        rel = media_list[i].get("path")
        if not rel:
            raise HTTPException(status_code=404, detail="Slide not found")
        path = get_settings().abs_path(rel)
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        ctype = "image/webp" if rel.lower().endswith(".webp") else "image/jpeg"
        return media.stream_file(path, request.headers.get("Range"), media_type=ctype)
```

- [ ] **Step 5 : Lancer — succès attendu**

Run: `cd backend && .venv/bin/python -m pytest tests/test_media_slides.py -q`
Expected: PASS (5 tests).

- [ ] **Step 6 : Étendre la purge DELETE aux slides**

In `backend/app/main.py`, in `delete_video`, replace the purge loop (lines ~181-188) :

```python
        settings = get_settings()
        rels = [row.get("storage_path"), row.get("thumb_path")]
        rels += [m.get("path") for m in (row.get("media") or [])]
        for rel in rels:
            if not rel:
                continue
            try:
                settings.abs_path(rel).unlink()
            except (FileNotFoundError, ValueError):
                pass
        # Retire le dossier de slides s'il est vide (post image).
        for rel in (row.get("storage_path"),):
            if rel and "/" in rel:
                try:
                    settings.abs_path(rel).parent.rmdir()
                except (FileNotFoundError, OSError, ValueError):
                    pass
```

- [ ] **Step 7 : Écrire le test de purge des slides**

Append to `backend/tests/test_delete.py` :

```python
def test_delete_purges_image_slides(client, env, monkeypatch):
    from app.config import get_settings
    s = get_settings()
    rels = ["videos/owner-1/vid-c/0.jpg", "videos/owner-1/vid-c/1.jpg"]
    thumb = "thumbs/owner-1/vid-c.jpg"
    for rel in rels + [thumb]:
        p = s.abs_path(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
    row = {
        "id": "vid-c", "user_id": "owner-1", "status": "ready",
        "media_type": "image",
        "media": [{"i": 0, "path": rels[0]}, {"i": 1, "path": rels[1]}],
        "storage_path": rels[0], "thumb_path": thumb,
    }
    _patch_supa(monkeypatch, row=row, deleted={})

    r = client.delete("/api/videos/vid-c", headers=_auth())

    assert r.status_code == 204
    for rel in rels + [thumb]:
        assert not s.abs_path(rel).exists()
```

- [ ] **Step 8 : Lancer delete + toute la suite backend**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: PASS (suite complète, y c. les nouveaux tests).

- [ ] **Step 9 : Commit**

```bash
git add backend/app/models.py backend/app/main.py backend/tests/test_media_slides.py backend/tests/test_delete.py
git commit -m "feat(api): route slide/{i} signée, media-url enrichi, purge des slides au delete"
```

---

## Task 6 : Types & client front

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1 : Étendre les types**

In `frontend/src/lib/types.ts`, add after the `Video` interface :

```typescript
export type MediaType = 'video' | 'image';

/** Une slide d'un post image (le `path` jsonb est ignoré côté front). */
export interface MediaSlide {
  i: number;
  w: number | null;
  h: number | null;
}
```

In the same file, add the two fields to `Video` :

```typescript
export interface Video {
  id: string;
  category_id: string | null;
  source_url: string;
  title: string;
  author: string | null;
  duration_seconds: number | null;
  thumb_color: string;
  status: VideoStatus;
  error: string | null;
  created_at: string;
  media_type: MediaType;
  media: MediaSlide[] | null;
}
```

And replace `MediaUrls` :

```typescript
export interface MediaUrls {
  media_type: MediaType;
  stream_url?: string;   // vidéo
  slides?: string[];     // post image : une URL signée par slide
  thumb_url: string;
}
```

- [ ] **Step 2 : Ajouter le résolveur de slides au client**

In `frontend/src/lib/api.ts`, after `getMediaUrl` (line ~126), add :

```typescript
/**
 * Résout les URLs signées des slides d'un post image (ordre = index). Renvoie
 * un tableau vide si le post n'est pas une image (sécurité d'appel).
 */
export async function getSlides(id: string): Promise<string[]> {
  const m = await getMediaUrl(id);
  return m.slides ?? [];
}
```

- [ ] **Step 3 : Vérifier la compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 erreur. (Si `tsc` signale `media_type` manquant ailleurs, c'est attendu : corrigé aux tâches 7-8.)

> Note : à cette étape `VideoCard`/mocks éventuels peuvent manquer `media_type`. Si `tsc` échoue uniquement là-dessus, continuer — la tâche 7 le résout — mais ne PAS committer tant que `tsc` n'est pas vert (faire tâche 7 puis committer ensemble si besoin). En pratique `Video` est construit depuis Supabase (`select('*')`), pas de littéraux à corriger.

- [ ] **Step 4 : Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts
git commit -m "feat(front): types media_type/media + résolveur getSlides"
```

---

## Task 7 : Carte de bibliothèque — badge carrousel

**Files:**
- Modify: `frontend/src/components/Icons.tsx`
- Modify: `frontend/src/components/VideoCard.tsx`

- [ ] **Step 1 : Ajouter l'icône carrousel**

In `frontend/src/components/Icons.tsx`, add an entry to the `Icons` object (e.g. after `plus`) :

```tsx
  carousel: (p: IconProps) => (
    <Ico {...p}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </Ico>
  ),
```

- [ ] **Step 2 : Badge compteur + pas de play sur une image**

In `frontend/src/components/VideoCard.tsx` :

1. After `const ready = video.status === 'ready';` (line ~41), add :

```tsx
  const isImage = video.media_type === 'image';
  const slideCount = video.media?.length ?? 0;
```

2. Replace the `Thumb` line (line ~111) to hide the play icon on an image :

```tsx
          <Thumb video={{ thumb_color: video.thumb_color, thumbUrl }} radius="0" showPlay={ready && !isImage} />
```

3. Replace the ready badge (the first branch of the `ready ? (...)` block, lines ~152-173) so an image shows the carousel counter instead of a duration :

```tsx
          {ready ? (
            <span
              style={{
                position: 'absolute',
                bottom: 12,
                right: 12,
                height: 24,
                padding: '0 9px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 600,
                color: '#fff',
                background: 'rgba(10,10,12,0.5)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.12)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {isImage ? (
                <>
                  <Icons.carousel size={13} />
                  {slideCount || 1}
                </>
              ) : (
                formatDuration(video.duration_seconds)
              )}
            </span>
          ) : video.status === 'error' ? (
```

- [ ] **Step 3 : Vérifier compilation + build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 0 erreur TS, build OK.

- [ ] **Step 4 : Commit**

```bash
git add frontend/src/components/Icons.tsx frontend/src/components/VideoCard.tsx
git commit -m "feat(front): badge carrousel sur la carte, pas de play sur une image"
```

---

## Task 8 : Visualiseur swipe (GalleryScreen) + routage

**Files:**
- Create: `frontend/src/screens/MediaActionSheet.tsx`
- Modify: `frontend/src/screens/PlayerScreen.tsx`
- Create: `frontend/src/screens/galleryLogic.ts`
- Create: `frontend/src/screens/galleryLogic.test.ts`
- Create: `frontend/src/screens/GalleryScreen.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1 : Extraire le sheet d'actions partagé**

Create `frontend/src/screens/MediaActionSheet.tsx` (déplacement verbatim de `PlayerSheet` + `ActionBtn` + `SheetRow` + `SheetType` depuis `PlayerScreen.tsx`, rendus partageables) :

```tsx
// ============================================================
// Réelgram — Bottom sheet d'actions média (renommer / catégorie / supprimer)
// Partagé par PlayerScreen (vidéo) et GalleryScreen (images). Comportement
// identique à l'ancien PlayerSheet ; simple extraction pour réutilisation (DRY).
// ============================================================
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Icons, type IconProps } from '../components/Icons';
import type { Category } from '../lib/types';

export type SheetType = 'rename' | 'category' | 'delete' | 'more';

export interface ActionBtnProps {
  icon: (p: IconProps) => ReactNode;
  onClick: () => void;
  danger?: boolean;
  label?: string;
}

export function ActionBtn({ icon: Icon, onClick, danger, label }: ActionBtnProps) {
  return (
    <button onClick={onClick} aria-label={label ?? 'Action'} style={{ width: 54, height: 54, borderRadius: 16, display: 'grid', placeItems: 'center',
      background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)', border: '1px solid var(--hairline)',
      color: danger ? '#ff8a96' : '#fff' }}>
      <Icon size={21} />
    </button>
  );
}

export interface MediaActionSheetProps {
  type: SheetType;
  title: string;
  categories: Category[];
  currentCategoryId: string | null;
  onClose: () => void;
  onRename: (title: string) => void;
  onCategory: (id: string | null) => void;
  onDelete: () => void;
}

export function MediaActionSheet({ type, title, categories, currentCategoryId, onClose, onRename, onCategory, onDelete }: MediaActionSheetProps) {
  const [draft, setDraft] = useState(title);
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', animation: 'fadeBg 0.25s ease both' }}>
      <style>{`@keyframes fadeBg{from{opacity:0}to{opacity:1}}@keyframes sheetUp{from{transform:translateY(100%)}to{transform:none}}`}</style>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-1)', borderRadius: '26px 26px 0 0', border: '1px solid var(--hairline)', borderBottom: 'none',
        padding: '10px 22px calc(env(safe-area-inset-bottom,0px) + 26px)', animation: 'sheetUp 0.36s var(--ease) both', boxShadow: '0 -20px 60px -20px rgba(0,0,0,0.8)' }}>
        <div style={{ width: 40, height: 5, borderRadius: 999, background: 'var(--hairline-strong)', margin: '0 auto 18px' }} />

        {type === 'more' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <SheetRow icon={Icons.edit} label="Renommer" onClick={() => {}} disabled />
            <p style={{ fontSize: 13, color: 'var(--txt-2)', textAlign: 'center', padding: 20 }}>Utilise les actions ci-dessous.</p>
          </div>
        )}

        {type === 'rename' && (
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 680, marginBottom: 16 }}>Renommer</h3>
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onRename(draft)}
              style={{ width: '100%', height: 54, padding: '0 16px', borderRadius: 15, background: 'var(--bg-2)', border: '1px solid var(--hairline-strong)', color: 'var(--txt-0)', fontSize: 16, outline: 'none' }} />
            <button className="btn-primary" style={{ marginTop: 18 }} onClick={() => onRename(draft)}><Icons.check size={19} /> Enregistrer</button>
          </div>
        )}

        {type === 'category' && (
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 680, marginBottom: 16 }}>Changer de catégorie</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {categories.map((c) => (
                <button key={c.id} onClick={() => onCategory(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 14px', borderRadius: 14,
                  background: c.id === currentCategoryId ? 'var(--bg-3)' : 'transparent', border: '1px solid ' + (c.id === currentCategoryId ? 'var(--hairline-strong)' : 'transparent') }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: c.color, boxShadow: `0 0 12px -1px ${c.color}` }} />
                  <span style={{ fontSize: 15.5, fontWeight: 540, color: 'var(--txt-0)' }}>{c.label}</span>
                  {c.id === currentCategoryId && <span style={{ marginLeft: 'auto', color: 'var(--a-violet)' }}><Icons.check size={19} /></span>}
                </button>
              ))}
              <button onClick={() => onCategory(null)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 14px', borderRadius: 14,
                background: currentCategoryId === null ? 'var(--bg-3)' : 'transparent', border: '1px solid ' + (currentCategoryId === null ? 'var(--hairline-strong)' : 'transparent') }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--txt-3)' }} />
                <span style={{ fontSize: 15.5, fontWeight: 540, color: 'var(--txt-0)' }}>Sans catégorie</span>
                {currentCategoryId === null && <span style={{ marginLeft: 'auto', color: 'var(--a-violet)' }}><Icons.check size={19} /></span>}
              </button>
            </div>
          </div>
        )}

        {type === 'delete' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,93,108,0.12)', display: 'grid', placeItems: 'center', margin: '4px auto 16px', color: '#ff8a96' }}>
              <Icons.trash size={26} />
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 680 }}>Supprimer cette publication ?</h3>
            <p style={{ fontSize: 14, color: 'var(--txt-1)', marginTop: 8, lineHeight: 1.5 }}>Elle sera retirée de ta bibliothèque. Cette action est définitive.</p>
            <button onClick={onDelete} style={{ marginTop: 22, width: '100%', height: 54, borderRadius: 16, fontSize: 16, fontWeight: 640, color: '#fff', background: '#e8475a' }}>Supprimer</button>
            <button className="btn-ghost" style={{ marginTop: 10 }} onClick={onClose}>Annuler</button>
          </div>
        )}
      </div>
    </div>
  );
}

interface SheetRowProps {
  icon: (p: IconProps) => ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function SheetRow({ icon: Icon, label, onClick, disabled }: SheetRowProps) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 14px', borderRadius: 14, opacity: disabled ? 0.4 : 1 }}>
      <Icon size={20} style={{ color: 'var(--txt-1)' }} /><span style={{ fontSize: 15.5, color: 'var(--txt-0)' }}>{label}</span>
    </button>
  );
}
```

- [ ] **Step 2 : Faire pointer PlayerScreen sur le sheet partagé**

In `frontend/src/screens/PlayerScreen.tsx` :

1. Add the import near the other imports (after line 14) :

```tsx
import { MediaActionSheet, ActionBtn, type SheetType } from './MediaActionSheet';
```

2. Delete the now-duplicated local declarations: the `type SheetType = ...` line (line ~28), the JSX usage stays but rename `PlayerSheet` → `MediaActionSheet`, and remove the bottom definitions of `ActionBtn`, `ActionBtnProps`, `PlayerSheetProps`, `PlayerSheet`, `SheetRowProps`, `SheetRow` (lines ~169-276).

3. In the render, replace the `<PlayerSheet ... />` usage (line ~158) with `<MediaActionSheet ... />` (same props).

- [ ] **Step 3 : Écrire la logique pure d'index + son test**

Create `frontend/src/screens/galleryLogic.ts` :

```typescript
// Index de slide actif déduit de la position de scroll horizontal (scroll-snap).
// Pur et borné → testable sans DOM.
export function activeIndexFromScroll(scrollLeft: number, slideWidth: number, count: number): number {
  if (slideWidth <= 0 || count <= 0) return 0;
  const idx = Math.round(scrollLeft / slideWidth);
  return Math.max(0, Math.min(count - 1, idx));
}
```

Create `frontend/src/screens/galleryLogic.test.ts` :

```typescript
import { describe, it, expect } from 'vitest';
import { activeIndexFromScroll } from './galleryLogic';

describe('activeIndexFromScroll', () => {
  it('maps scroll position to the nearest slide', () => {
    expect(activeIndexFromScroll(0, 320, 3)).toBe(0);
    expect(activeIndexFromScroll(170, 320, 3)).toBe(1);  // > moitié → arrondi au suivant
    expect(activeIndexFromScroll(320, 320, 3)).toBe(1);
    expect(activeIndexFromScroll(640, 320, 3)).toBe(2);
  });

  it('clamps within [0, count-1] and tolerates degenerate inputs', () => {
    expect(activeIndexFromScroll(99999, 320, 3)).toBe(2);
    expect(activeIndexFromScroll(-50, 320, 3)).toBe(0);
    expect(activeIndexFromScroll(100, 0, 3)).toBe(0);
    expect(activeIndexFromScroll(100, 320, 0)).toBe(0);
  });
});
```

Run: `cd frontend && npx vitest run src/screens/galleryLogic.test.ts`
Expected: PASS (2).

- [ ] **Step 4 : Écrire GalleryScreen**

Create `frontend/src/screens/GalleryScreen.tsx` :

```tsx
// ============================================================
// Réelgram — Visualiseur d'un post image (carrousel swipe, image entière)
// Reprend le décor du lecteur (barre du haut, fond flou ambiant, rangée
// d'actions) mais remplace l'étage vidéo par une piste swipe horizontale
// (scroll-snap natif) : chaque photo est montrée ENTIÈRE (contain) sur fond
// flou. Pastilles + compteur. Pas de scrub/play.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { Icons } from '../components/Icons';
import { StatusBar } from '../components/StatusBar';
import type { Category, Video } from '../lib/types';
import { categoryFor, formatAuthor, formatDate } from '../lib/format';
import { gradientFromColor } from '../lib/color';
import { MediaActionSheet, ActionBtn, type SheetType } from './MediaActionSheet';
import { activeIndexFromScroll } from './galleryLogic';

export interface GalleryScreenProps {
  video: Video;
  categories: Category[];
  /** URLs signées des slides (ordre = index) ; null pendant la résolution. */
  slides: string[] | null;
  onBack: () => void;
  onUpdate: (fields: { title?: string; category_id?: string | null }) => void;
  onDelete: (video: Video) => void;
}

export function GalleryScreen({ video, categories, slides, onBack, onUpdate, onDelete }: GalleryScreenProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [sheet, setSheet] = useState<SheetType | null>(null);
  const [title, setTitle] = useState(video.title);

  const cat = categoryFor(video.category_id, categories);
  const glow = gradientFromColor(video.thumb_color)[1];
  const count = slides?.length ?? video.media?.length ?? 0;

  useEffect(() => { setTitle(video.title); }, [video.title]);

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    setActive(activeIndexFromScroll(el.scrollLeft, el.clientWidth, count));
  };

  return (
    <div className="view modal-enter" style={{ background: '#060608' }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(90% 60% at 50% 30%, ${glow}55, transparent 65%)`, filter: 'blur(30px)', opacity: 0.7 }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.4), transparent 30%, transparent 70%, rgba(0,0,0,0.6))' }} />

      <StatusBar />
      {/* top bar */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 18px' }}>
        <button onClick={onBack} aria-label="Retour" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)', border: '1px solid var(--hairline)', color: '#fff' }}>
          <Icons.back size={20} />
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 560, color: 'rgba(255,255,255,0.8)' }}>
          <span className="cat-dot" style={{ background: cat.color }} />{cat.label}
        </span>
        <button onClick={() => setSheet('more')} aria-label="Plus d'options" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)', border: '1px solid var(--hairline)', color: '#fff' }}>
          <Icons.more size={20} />
        </button>
      </div>

      {/* stage : piste swipe horizontale (scroll-snap) */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0' }}>
        {slides ? (
          <div
            ref={trackRef}
            onScroll={onScroll}
            style={{ display: 'flex', width: '100%', height: '100%', overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}
          >
            {slides.map((src, i) => (
              <div key={i} style={{ position: 'relative', flex: '0 0 100%', width: '100%', height: '100%', scrollSnapAlign: 'center', display: 'grid', placeItems: 'center' }}>
                {/* fond flou ambiant = la photo elle-même, agrandie/floutée */}
                <img src={src} alt="" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(28px) brightness(0.5)', transform: 'scale(1.2)' }} />
                {/* la photo entière (contain), jamais recadrée */}
                <img src={src} alt={`Photo ${i + 1} sur ${count}`} style={{ position: 'relative', maxWidth: '92%', maxHeight: '100%', objectFit: 'contain', borderRadius: 18, boxShadow: '0 30px 70px -25px rgba(0,0,0,0.9)' }} />
              </div>
            ))}
          </div>
        ) : (
          <span style={{ width: 28, height: 28, borderRadius: '50%', border: '2.6px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} />
        )}
      </div>

      {/* pastilles + compteur */}
      {count > 1 && (
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '4px 0 2px' }}>
          {Array.from({ length: count }).map((_, i) => (
            <span key={i} style={{ width: i === active ? 7 : 5, height: i === active ? 7 : 5, borderRadius: '50%', background: i === active ? '#fff' : 'rgba(255,255,255,0.4)', transition: 'all 0.2s' }} />
          ))}
        </div>
      )}

      {/* infos + actions */}
      <div style={{ position: 'relative', zIndex: 2, padding: '6px 24px calc(env(safe-area-inset-bottom,0px) + 26px)' }}>
        <h1 style={{ marginTop: 12, fontSize: 21, fontWeight: 680, letterSpacing: '-0.02em', lineHeight: 1.25, color: '#fff' }}>{title}</h1>
        <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
          <Icons.insta size={15} /> {formatAuthor(video.author)} <span style={{ opacity: 0.4 }}>·</span> {formatDate(video.created_at)}
          {count > 1 && (<><span style={{ opacity: 0.4 }}>·</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icons.carousel size={14} /> {active + 1}/{count}</span></>)}
        </div>

        <div style={{ marginTop: 22, display: 'flex', gap: 10 }}>
          <ActionBtn icon={Icons.edit} onClick={() => setSheet('rename')} label="Renommer" />
          <ActionBtn icon={Icons.tag} onClick={() => setSheet('category')} label="Changer de catégorie" />
          <ActionBtn icon={Icons.trash} onClick={() => setSheet('delete')} danger label="Supprimer" />
        </div>
      </div>

      {sheet && <MediaActionSheet
        type={sheet} title={title} categories={categories} currentCategoryId={video.category_id}
        onClose={() => setSheet(null)}
        onRename={(t) => { const next = t.trim(); if (next) { setTitle(next); onUpdate({ title: next }); } setSheet(null); }}
        onCategory={(id) => { onUpdate({ category_id: id }); setSheet(null); }}
        onDelete={() => { setSheet(null); onDelete(video); }}
      />}
    </div>
  );
}
```

- [ ] **Step 5 : Router les posts image vers GalleryScreen**

In `frontend/src/App.tsx` :

1. Add the imports (after the PlayerScreen import, line ~29) :

```tsx
import { GalleryScreen } from './screens/GalleryScreen';
import { getSlides } from './lib/api';
```

(`getMediaUrl` is already imported on line 20 ; just append `getSlides` to that existing import or add the line above.)

2. Add slides state next to `streamUrl` (line ~135) :

```tsx
  const [slides, setSlides] = useState<string[] | null>(null);
```

3. Replace `openVideo` (lines ~266-280) to branch on `media_type` :

```tsx
  const openVideo = async (v: Video) => {
    setCurrent(v);
    setStreamUrl(null);
    setSlides(null);
    go('player');
    const reqId = ++openVideoReq.current;
    try {
      if (v.media_type === 'image') {
        const s = await getSlides(v.id);
        if (openVideoReq.current === reqId) setSlides(s);
      } else {
        const { stream_url } = await getMediaUrl(v.id);
        if (openVideoReq.current === reqId) setStreamUrl(stream_url ?? null);
      }
    } catch {
      if (openVideoReq.current === reqId) { setStreamUrl(null); setSlides(null); }
    }
  };
```

4. Replace the `player` route block (lines ~378-382) to pick the right screen :

```tsx
        {route === 'player' && current && (
          current.media_type === 'image'
            ? <GalleryScreen video={current} categories={categories} slides={slides}
                onBack={() => go('library')} onUpdate={handleUpdateVideo}
                onDelete={(v) => { void handleDeleteVideo(v); go('library'); }} />
            : <PlayerScreen video={current} categories={categories} streamUrl={streamUrl}
                onBack={() => go('library')} onUpdate={handleUpdateVideo}
                onDelete={(v) => { void handleDeleteVideo(v); go('library'); }} />
        )}
```

- [ ] **Step 6 : Vérifier compilation, tests, build**

Run: `cd frontend && npx tsc --noEmit && npx vitest run && npm run build`
Expected: 0 erreur TS, tous les vitest verts (dont `galleryLogic`), build OK.

- [ ] **Step 7 : Commit**

```bash
git add frontend/src/screens/MediaActionSheet.tsx frontend/src/screens/PlayerScreen.tsx frontend/src/screens/galleryLogic.ts frontend/src/screens/galleryLogic.test.ts frontend/src/screens/GalleryScreen.tsx frontend/src/App.tsx
git commit -m "feat(front): GalleryScreen swipe (image entière) + routage des posts image"
```

---

## Task 9 : Dépendance gallery-dl (backend + Docker + doc)

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `README.md`

- [ ] **Step 1 : Ajouter la dépendance**

In `backend/requirements.txt`, add a line :

```
gallery-dl
```

- [ ] **Step 2 : Installer dans le venv + vérifier le binaire**

Run: `cd backend && .venv/bin/pip install gallery-dl && .venv/bin/gallery-dl --version`
Expected: un numéro de version s'affiche.

- [ ] **Step 3 : Vérifier la présence dans l'image Docker**

The backend `Dockerfile` already does `pip install -r requirements.txt`, so gallery-dl ships in the image like yt-dlp. Confirm there is no extra system package needed.

Run: `grep -n "requirements.txt" backend/Dockerfile`
Expected: une ligne `pip install ... -r requirements.txt` (gallery-dl est pur Python, rien d'autre à ajouter).

- [ ] **Step 4 : Documenter (cookies partagés)**

In `README.md`, in the cookies / ingestion section, add a note that image posts (photos & carousels) are extracted via **gallery-dl**, which reuses the **same** `IG_COOKIES_FILE` as yt-dlp (no second config). Place it next to the existing cookies explanation.

- [ ] **Step 5 : Commit**

```bash
git add backend/requirements.txt README.md
git commit -m "build(backend): ajoute gallery-dl (mêmes cookies IG que yt-dlp) + doc"
```

---

## Task 10 : Vérification globale

**Files:** aucun (vérification + éventuels correctifs).

- [ ] **Step 1 : Schéma**

Run: `bash supabase/test/run_schema_test.sh`
Expected: `TEST1…TEST4 OK` + `ALL SCHEMA TESTS PASSED`.

- [ ] **Step 2 : Backend**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: tout vert (suite existante + nouveaux tests ingest/media/delete).

- [ ] **Step 3 : Frontend**

Run: `cd frontend && npx tsc --noEmit && npx vitest run && npm run build`
Expected: 0 erreur TS, tous les vitest verts, build OK.

- [ ] **Step 4 : (Optionnel) fumée Docker**

Si l'environnement le permet : `docker compose build` puis vérifier que `gallery-dl --version` répond dans le conteneur `api`.

- [ ] **Step 5 : Récapituler l'état**

Confirmer dans la PR/branche que les 9 tâches sont committées et la suite verte. La vérification d'intégration réelle (un vrai carrousel Instagram avec cookies valides) se fait au déploiement (gallery-dl est isolé + mocké en tests unitaires).

---

## Self-Review (rempli à l'écriture du plan)

**Couverture spec :**
- §1 modèle de données → Task 1. §2 ingestion (classification, branche image, repli) → Tasks 2-4. §3 service média (slide route, media-url, content-type) → Task 5. §4 frontend (types, carte, GalleryScreen, routage) → Tasks 6-8. §5 statuts/erreurs → Tasks 4 (transitions + repli). §6 suppression slides → Task 5. §7 dépendances/Docker → Task 9. §8 tests → répartis (TDD) + Task 10. §9 hors-périmètre respecté (aucune table media_items, aucun re-encodage, pas de vidéo dans le swipe).

**Cohérence des types/signatures :**
- `media` jsonb = `{i, path, w, h}` côté backend (Task 4) ; le front lit `{i, w, h}` (`MediaSlide`, Task 6), `path` ignoré (servi via URLs signées) — cohérent.
- `_thumbnail(src, dst, seek=True)` défini Task 3, appelé vidéo (2 args) Task 4 et image (`, False`) Task 4 — cohérent.
- `MediaUrls` : `media_type` + `stream_url?`/`slides?` + `thumb_url`, identique backend (Task 5) et front (Task 6).
- `MediaActionSheet`/`ActionBtn`/`SheetType` exportés (Task 8 step 1) et importés par PlayerScreen (step 2) et GalleryScreen (step 4) — cohérent.
- `activeIndexFromScroll(scrollLeft, slideWidth, count)` défini + testé + utilisé avec `el.clientWidth` — cohérent.

**Placeholders :** aucun (chaque step porte le code complet).
