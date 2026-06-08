# Titres de reels parlants — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le titre synthétique `Video by xxx` (yt-dlp/Instagram) par un titre dérivé de la légende du reel, et stocker la légende complète + la date de publication aujourd'hui jetées.

**Architecture:** Tout se passe dans `backend/app/ingest.py` : une chaîne de résolution `_resolve_title(info)` (légende → vrai titre non-synthétique → `@auteur · date` → `Sans titre`) plus des helpers purs pour la légende et la date. Une migration Supabase ajoute deux colonnes. Aucun changement frontend (le titre remonte via la colonne `title` déjà affichée).

**Tech Stack:** Python 3.13, FastAPI, yt-dlp, pytest (`asyncio_mode=auto`), Supabase (Postgres + SQL migrations).

**Spec:** `docs/superpowers/specs/2026-06-08-reel-titles-from-caption-design.md`

**Commande de test :** `cd /opt/Réelgram/backend && .venv/bin/pytest`

**Conventions :** DRY, YAGNI, TDD, commits fréquents. Chaque commit se termine par
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Carte des fichiers

- **Créer** `supabase/migrations/0002_add_caption_published_at.sql` — ajoute `caption` + `published_at`.
- **Modifier** `backend/app/ingest.py` — imports (`re`, `datetime`), 7 helpers nouveaux dans la section `--- metadata extraction ---`, suppression de `_extract_title`, câblage dans `run_ingest`.
- **Modifier** `backend/tests/test_ingest.py` — tests unitaires des helpers + un test d'intégration `run_ingest` avec légende. Les tests existants restent inchangés.

Tous les helpers sont des fonctions **pures** (pas d'I/O) → testables isolément.

---

### Task 1: Migration Supabase (colonnes `caption` + `published_at`)

**Files:**
- Create: `supabase/migrations/0002_add_caption_published_at.sql`

- [ ] **Step 1: Écrire la migration**

```sql
-- Réelgram — légende + date de publication (titres parlants)
-- Spec: docs/superpowers/specs/2026-06-08-reel-titles-from-caption-design.md
alter table public.videos add column if not exists caption      text;
alter table public.videos add column if not exists published_at timestamptz;
```

- [ ] **Step 2: Vérifier la syntaxe (lecture seule, pas de DB ici)**

Relire le fichier : deux `add column if not exists`, idempotent, pas de changement RLS (la policy `own videos` couvre déjà toutes les colonnes). La migration sera appliquée à Supabase hors de ce plan.

- [ ] **Step 3: Commit**

```bash
cd /opt/Réelgram
git add supabase/migrations/0002_add_caption_published_at.sql
git commit -m "feat(db): add videos.caption + videos.published_at

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Helper `_format_fr_date` (date FR sans locale) + imports

**Files:**
- Modify: `backend/app/ingest.py` (imports en tête ; helper dans la section `--- metadata extraction ---`, après `_extract_duration`)
- Test: `backend/tests/test_ingest.py`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `backend/tests/test_ingest.py` :

```python
# --- titres parlants : helpers de date ---------------------------------------

def test_format_fr_date_iso_datetime():
    assert ingest._format_fr_date("2026-05-12T08:30:00+00:00") == "12 mai 2026"


def test_format_fr_date_date_only():
    assert ingest._format_fr_date("2026-05-12") == "12 mai 2026"


def test_format_fr_date_none():
    assert ingest._format_fr_date(None) is None
    assert ingest._format_fr_date("pas une date") is None
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k format_fr_date -v`
Expected: FAIL — `AttributeError: module 'app.ingest' has no attribute '_format_fr_date'`

- [ ] **Step 3: Ajouter les imports**

En tête de `backend/app/ingest.py`, compléter le bloc d'imports (après `import subprocess`) :

```python
import re
from datetime import datetime, timezone
```

- [ ] **Step 4: Implémenter `_format_fr_date`**

Dans la section `--- metadata extraction ---` de `backend/app/ingest.py`, après `_extract_duration` :

```python
_FR_MONTHS = (
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
)


def _format_fr_date(iso: Optional[str]) -> Optional[str]:
    """Format an ISO date/datetime string as a French ``"12 mai 2026"`` label.

    Locale-independent (container locales are unreliable). Returns None on any
    unparseable input.
    """
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(str(iso)[:10])
        except (TypeError, ValueError):
            return None
    return f"{dt.day} {_FR_MONTHS[dt.month - 1]} {dt.year}"
```

- [ ] **Step 5: Lancer pour vérifier le succès**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k format_fr_date -v`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
cd /opt/Réelgram
git add backend/app/ingest.py backend/tests/test_ingest.py
git commit -m "feat(ingest): _format_fr_date helper (locale-free FR date)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Helper `_extract_published_at` (timestamp / upload_date → ISO)

**Files:**
- Modify: `backend/app/ingest.py` (section metadata extraction)
- Test: `backend/tests/test_ingest.py`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `backend/tests/test_ingest.py` :

```python
def test_extract_published_at_from_timestamp():
    # epoch 0 = 1970-01-01T00:00:00+00:00
    assert ingest._extract_published_at({"timestamp": 0}).startswith("1970-01-01")


def test_extract_published_at_from_upload_date():
    assert ingest._extract_published_at({"upload_date": "20260512"}).startswith("2026-05-12")


def test_extract_published_at_missing():
    assert ingest._extract_published_at({}) is None
    assert ingest._extract_published_at({"upload_date": "pas-une-date"}) is None
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k extract_published_at -v`
Expected: FAIL — `AttributeError: ... '_extract_published_at'`

- [ ] **Step 3: Implémenter `_extract_published_at`**

Dans `backend/app/ingest.py`, après `_format_fr_date` :

```python
def _extract_published_at(info: dict) -> Optional[str]:
    """Return the reel's publish time as an ISO-8601 UTC string, or None.

    Prefers yt-dlp's ``timestamp`` (Unix epoch); falls back to ``upload_date``
    (``YYYYMMDD``). Defensive: any bad value yields None rather than raising.
    """
    ts = info.get("timestamp")
    if isinstance(ts, (int, float)) and not isinstance(ts, bool):
        try:
            return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            pass
    ud = info.get("upload_date")
    if ud and re.fullmatch(r"\d{8}", str(ud)):
        s = str(ud)
        try:
            return datetime(int(s[:4]), int(s[4:6]), int(s[6:8]), tzinfo=timezone.utc).isoformat()
        except ValueError:
            pass
    return None
```

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k extract_published_at -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd /opt/Réelgram
git add backend/app/ingest.py backend/tests/test_ingest.py
git commit -m "feat(ingest): _extract_published_at (timestamp/upload_date -> ISO)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Helper `_extract_caption` (légende brute)

**Files:**
- Modify: `backend/app/ingest.py` (section metadata extraction)
- Test: `backend/tests/test_ingest.py`

- [ ] **Step 1: Écrire les tests qui échouent**

```python
def test_extract_caption_present_is_raw():
    info = {"description": "Recette 🍋\n\n#food #pasta"}
    assert ingest._extract_caption(info) == "Recette 🍋\n\n#food #pasta"


def test_extract_caption_blank_or_missing():
    assert ingest._extract_caption({"description": "   "}) is None
    assert ingest._extract_caption({}) is None
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k extract_caption -v`
Expected: FAIL — `AttributeError: ... '_extract_caption'`

- [ ] **Step 3: Implémenter `_extract_caption`**

```python
def _extract_caption(info: dict) -> Optional[str]:
    """Return the raw, complete caption (yt-dlp ``description``), or None.

    Stored verbatim — cleaning is applied only to the derived title, never to the
    caption we persist.
    """
    desc = info.get("description")
    if isinstance(desc, str) and desc.strip():
        return desc
    return None
```

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k extract_caption -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd /opt/Réelgram
git add backend/app/ingest.py backend/tests/test_ingest.py
git commit -m "feat(ingest): _extract_caption (store raw caption)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Helper `_is_synthetic_title` (détection `Video by …`)

**Files:**
- Modify: `backend/app/ingest.py` (section metadata extraction)
- Test: `backend/tests/test_ingest.py`

- [ ] **Step 1: Écrire les tests qui échouent**

```python
def test_is_synthetic_title_matches_video_by():
    assert ingest._is_synthetic_title("Video by cool.creator", {}) is True
    assert ingest._is_synthetic_title("video by someone", {}) is True


def test_is_synthetic_title_real_title():
    assert ingest._is_synthetic_title("Ma vraie vidéo", {}) is False
    assert ingest._is_synthetic_title("", {}) is False
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k is_synthetic_title -v`
Expected: FAIL — `AttributeError: ... '_is_synthetic_title'`

- [ ] **Step 3: Implémenter `_is_synthetic_title`**

```python
def _is_synthetic_title(title: str, info: dict) -> bool:
    """True when ``title`` is yt-dlp's synthetic Instagram title ``Video by …``.

    Instagram reels have no real title; yt-dlp fabricates ``"Video by {uploader}"``.
    Detecting it lets the title chain skip it instead of reintroducing the very
    string we are replacing.
    """
    t = (title or "").strip()
    if not t:
        return False
    if re.match(r"video by \S", t, re.IGNORECASE):
        return True
    uploader = info.get("uploader") or info.get("uploader_id")
    if uploader and t.lower() == f"video by {str(uploader).strip()}".lower():
        return True
    return False
```

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k is_synthetic_title -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd /opt/Réelgram
git add backend/app/ingest.py backend/tests/test_ingest.py
git commit -m "feat(ingest): _is_synthetic_title (detect yt-dlp 'Video by …')

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Helpers `_truncate_words` + `_clean_caption_line` (1re ligne utile)

**Files:**
- Modify: `backend/app/ingest.py` (section metadata extraction)
- Test: `backend/tests/test_ingest.py`

- [ ] **Step 1: Écrire les tests qui échouent**

```python
def test_clean_caption_line_strips_trailing_hashtags():
    line = ingest._clean_caption_line("Recette de pâtes au citron 🍋\n\n#food #pasta")
    assert line == "Recette de pâtes au citron 🍋"


def test_clean_caption_line_picks_first_useful_line():
    assert ingest._clean_caption_line("\n\nVraie ligne ici\nautre") == "Vraie ligne ici"


def test_clean_caption_line_hashtags_or_emoji_only():
    assert ingest._clean_caption_line("#food #pasta #yum") is None
    assert ingest._clean_caption_line("🍝🍋") is None
    assert ingest._clean_caption_line("") is None


def test_clean_caption_line_truncates_at_word_boundary():
    res = ingest._clean_caption_line("mot " * 40)  # ~160 chars
    assert len(res) <= ingest.TITLE_MAX
    assert res.endswith("…")
    assert not res.endswith(" …")  # coupé proprement à un mot
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k clean_caption_line -v`
Expected: FAIL — `AttributeError: ... '_clean_caption_line'`

- [ ] **Step 3: Implémenter `_truncate_words` puis `_clean_caption_line`**

```python
def _truncate_words(text: str, maxlen: int = TITLE_MAX) -> str:
    """Truncate to at most ``maxlen`` chars (ellipsis included) at a word boundary."""
    if len(text) <= maxlen:
        return text
    cut = text[: maxlen - 1].rstrip()
    if " " in cut:
        cut = cut[: cut.rfind(" ")].rstrip()
    return cut + "…"


def _clean_caption_line(description: str) -> Optional[str]:
    """Return the first *useful* line of a caption, cleaned, or None.

    Useful = still has an alphanumeric character after dropping hashtags/emojis.
    Cleaning is light: drop a trailing run of hashtags, collapse whitespace,
    truncate at a word boundary to TITLE_MAX. The middle of the line is left as-is.
    """
    for raw in (description or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        without_trailing_tags = re.sub(r"(\s*#[^\s#]+)+\s*$", "", line).strip()
        candidate = re.sub(r"\s+", " ", without_trailing_tags).strip()
        if re.search(r"[^\W_]", candidate):  # has a letter or digit
            return _truncate_words(candidate, TITLE_MAX)
    return None
```

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k clean_caption_line -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd /opt/Réelgram
git add backend/app/ingest.py backend/tests/test_ingest.py
git commit -m "feat(ingest): _clean_caption_line + _truncate_words (first useful line)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Helper `_fallback_title` (`@auteur · date`)

**Files:**
- Modify: `backend/app/ingest.py` (section metadata extraction)
- Test: `backend/tests/test_ingest.py`

- [ ] **Step 1: Écrire les tests qui échouent**

```python
def test_fallback_title_author_and_date():
    info = {"uploader_id": "bob", "upload_date": "20260512"}
    assert ingest._fallback_title(info) == "@bob · 12 mai 2026"


def test_fallback_title_author_only_when_no_date():
    assert ingest._fallback_title({"uploader_id": "bob"}) == "@bob"


def test_fallback_title_none_without_author():
    assert ingest._fallback_title({"upload_date": "20260512"}) is None
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k fallback_title -v`
Expected: FAIL — `AttributeError: ... '_fallback_title'`

- [ ] **Step 3: Implémenter `_fallback_title`**

```python
def _fallback_title(info: dict) -> Optional[str]:
    """Build ``@author · date`` (or ``@author`` if no date), else None.

    Reuses ``_extract_author`` for the ``@handle``. Returns None when there is no
    author, letting the caller fall back to DEFAULT_TITLE.
    """
    author = _extract_author(info)
    if not author:
        return None
    date = _format_fr_date(_extract_published_at(info))
    return f"{author} · {date}" if date else author
```

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k fallback_title -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd /opt/Réelgram
git add backend/app/ingest.py backend/tests/test_ingest.py
git commit -m "feat(ingest): _fallback_title (@author · date)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Chaîne `_resolve_title` (remplace `_extract_title`)

**Files:**
- Modify: `backend/app/ingest.py` (section metadata extraction — ajoute `_resolve_title`, supprime `_extract_title`)
- Test: `backend/tests/test_ingest.py`

- [ ] **Step 1: Écrire les tests qui échouent**

```python
def test_resolve_title_prefers_caption():
    info = {
        "title": "Video by cool.creator",
        "description": "Recette de pâtes au citron 🍋\n#food",
        "uploader_id": "cool.creator",
    }
    assert ingest._resolve_title(info) == "Recette de pâtes au citron 🍋"


def test_resolve_title_real_title_when_no_caption():
    info = {"title": "Ma vraie vidéo", "uploader_id": "bob"}
    assert ingest._resolve_title(info) == "Ma vraie vidéo"


def test_resolve_title_fallback_on_synthetic_without_caption():
    info = {"title": "Video by bob", "uploader_id": "bob", "upload_date": "20260512"}
    assert ingest._resolve_title(info) == "@bob · 12 mai 2026"


def test_resolve_title_caption_only_hashtags_falls_through():
    info = {"title": "Video by bob", "description": "#a #b", "uploader_id": "bob"}
    assert ingest._resolve_title(info) == "@bob"


def test_resolve_title_default_when_nothing():
    assert ingest._resolve_title({}) == ingest.DEFAULT_TITLE
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k resolve_title -v`
Expected: FAIL — `AttributeError: ... '_resolve_title'`

- [ ] **Step 3: Implémenter `_resolve_title` (garder `_extract_title` pour l'instant)**

Ajouter la fonction ci-dessous. **Ne pas** supprimer `_extract_title` à ce stade : `run_ingest` l'appelle encore jusqu'à Task 9, où l'appel sera remplacé puis la définition supprimée.

```python
def _resolve_title(info: dict) -> str:
    """Resolve a meaningful title for an ingested reel.

    Chain: (1) first useful caption line → (2) a real, non-synthetic yt-dlp
    title → (3) ``@author · date`` → (4) DEFAULT_TITLE. Pure and total: always
    returns a non-empty string.
    """
    from_caption = _clean_caption_line(info.get("description") or "")
    if from_caption:
        return from_caption

    title = (info.get("title") or "").strip()
    if title and not _is_synthetic_title(title, info):
        first_line = title.splitlines()[0].strip()
        if first_line:
            return _truncate_words(first_line, TITLE_MAX)

    return _fallback_title(info) or DEFAULT_TITLE
```

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py -k resolve_title -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd /opt/Réelgram
git add backend/app/ingest.py backend/tests/test_ingest.py
git commit -m "feat(ingest): _resolve_title chain (caption -> title -> author/date)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Câbler `run_ingest` (titre résolu + caption + published_at) et supprimer `_extract_title`

**Files:**
- Modify: `backend/app/ingest.py` (l'`update_video` final de `run_ingest` ; suppression de `_extract_title`)
- Test: `backend/tests/test_ingest.py`

- [ ] **Step 1: Écrire le test d'intégration qui échoue**

```python
async def test_run_ingest_title_from_caption(monkeypatch, tmp_path):
    _set_env(monkeypatch, tmp_path)
    rec = Recorder()
    monkeypatch.setattr(supa, "update_video", rec.update_video)

    def fake_download(url, dest, cookies, max_mb):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"x")
        return {
            "title": "Video by cool.creator",          # synthétique IG
            "description": "Recette de pâtes au citron 🍋\n\n#food #pasta",
            "uploader_id": "cool.creator",
            "duration": 30,
            "upload_date": "20260512",
        }

    monkeypatch.setattr(ingest, "_download", fake_download)
    monkeypatch.setattr(ingest, "_thumbnail", _write_thumb)
    monkeypatch.setattr(ingest, "_dominant_color", lambda src: "#a78bfa")
    monkeypatch.setattr(ingest, "_ensure_ios_compatible", lambda p: None)

    await ingest.run_ingest("vid-cap", "user-7", "https://instagram.com/reel/x/")

    final = rec.final
    assert final["status"] == "ready"
    assert final["title"] == "Recette de pâtes au citron 🍋"   # plus de "Video by …"
    assert final["caption"] == "Recette de pâtes au citron 🍋\n\n#food #pasta"
    assert final["published_at"].startswith("2026-05-12")
    assert final["author"] == "@cool.creator"
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest tests/test_ingest.py::test_run_ingest_title_from_caption -v`
Expected: FAIL — `KeyError: 'caption'` (run_ingest n'écrit pas encore `caption`/`published_at` et utilise encore l'ancien titre).

- [ ] **Step 3: Mettre à jour l'`update_video` final de `run_ingest`**

Dans `backend/app/ingest.py`, remplacer le bloc `update_video` final (status `ready`) par :

```python
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
```

- [ ] **Step 4: Supprimer la définition désormais inutilisée `_extract_title`**

Supprimer entièrement la fonction `_extract_title` de `backend/app/ingest.py` (elle n'est plus appelée).

- [ ] **Step 5: Vérifier la suppression**

Run: `cd /opt/Réelgram && grep -rn "_extract_title" backend/`
Expected: aucun résultat.

- [ ] **Step 6: Lancer la suite complète (nouveau test + non-régression)**

Run: `cd /opt/Réelgram/backend && .venv/bin/pytest -v`
Expected: PASS — tous les tests, dont `test_run_ingest_title_from_caption`, `test_run_ingest_happy_path`, `test_run_ingest_title_fallback`, `test_run_ingest_title_truncated` (les 3 derniers inchangés et toujours verts).

- [ ] **Step 7: Commit**

```bash
cd /opt/Réelgram
git add backend/app/ingest.py backend/tests/test_ingest.py
git commit -m "feat(ingest): wire _resolve_title + store caption/published_at

Remplace le titre synthétique 'Video by xxx' par un titre dérivé de la
légende, et persiste légende brute + date de publication. Supprime
_extract_title (absorbée par _resolve_title).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review (couverture spec)

- **Source titre = légende** → Task 6 (`_clean_caption_line`) + Task 8 (chaîne, étape 1). ✓
- **Repli `@auteur · date`** → Task 7 (`_fallback_title`) + Task 2 (`_format_fr_date`). ✓
- **Détection `Video by …`** → Task 5 (`_is_synthetic_title`), exercée en Task 8/9. ✓
- **Stockage légende brute** → Task 4 (`_extract_caption`) + Task 9 (câblage). ✓
- **Stockage date de publication** → Task 3 (`_extract_published_at`) + Task 9. ✓
- **Colonnes DB** → Task 1 (migration). ✓
- **Nouvelles ingestions seulement / pas de frontend** → aucun task frontend ni backfill (conforme au périmètre). ✓
- **Robustesse (jamais d'exception)** → helpers défensifs ; non-régression `test_run_ingest_download_error` vérifiée par la suite complète (Task 9 Step 6). ✓
- **Troncature ≤ 80 incl. ellipse** → `_truncate_words` (maxlen-1 puis `…`) ; non-régression `test_run_ingest_title_truncated` (≤ 80) verte en Task 9. ✓

Cohérence des signatures : `_resolve_title`, `_clean_caption_line`, `_truncate_words`, `_is_synthetic_title`, `_fallback_title`, `_extract_caption`, `_extract_published_at`, `_format_fr_date` — noms identiques entre définition (Tasks 2-8) et usage (Tasks 8-9). ✓
