# Partage public d'un réel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de partager un réel sauvegardé (vidéo ou carrousel) via une URL publique non listée, configurable temporaire (24 h / 7 j / 30 j) ou permanente, avec mot de passe optionnel, page destinataire brandée, et gestion par réel + vue globale.

**Architecture:** Nouvelle table `shares` (RLS propriétaire). Le backend FastAPI expose des routes **authentifiées** (CRUD des liens, propriétaire) et des routes **publiques** (`/api/share/{slug}/...`) scopées par slug via le service-role, jamais par `video_id` client. Le média public est servi par un `view_token` HMAC lié au slug (réutilise `MEDIA_TOKEN_SECRET`, payload distinct). La page destinataire est un **bundle Vite séparé** (`public-share.html`) qui n'importe NI Supabase NI le module d'auth ; le backend rend la coquille `/s/{slug}` avec meta OG par lien.

**Tech Stack:** FastAPI + Supabase (service-role), Pydantic, pytest/TestClient ; React + TypeScript + Vite (multi-entrée) + vitest ; hachage PIN via `hashlib.pbkdf2_hmac` (stdlib).

**Spec :** `docs/superpowers/specs/2026-06-12-public-share-link-design.md`

**Écarts assumés vs spec** (implémentabilité autonome) :
1. PIN haché en **pbkdf2_hmac (stdlib)**, pas argon2 — aucune dépendance nouvelle.
2. `view_token` réutilise **`MEDIA_TOKEN_SECRET`** avec un payload distinct (`sslug`) — pas de nouveau secret obligatoire.

---

## File Structure

**Backend (créés) :**
- `supabase/migrations/0005_shares.sql` — table `shares` + RLS + index.
- `backend/app/shares.py` — logique pure : génération de slug, hachage/vérif PIN (pbkdf2), calcul `expires_at`, calcul du statut, rate-limiter mémoire.
- `backend/tests/test_shares_unit.py` — tests de `shares.py`.
- `backend/tests/test_shares_api.py` — tests des routes authentifiées + publiques.

**Backend (modifiés) :**
- `backend/app/media.py` — ajoute `sign_share_token` / `verify_share_token`.
- `backend/app/supa.py` — helpers DB `shares` + `get_video_service`.
- `backend/app/models.py` — schémas Pydantic des liens.
- `backend/app/config.py` — `public_base_url`, `public_dist_dir`.
- `backend/app/main.py` — monte les routers `shares` (authed) + `share` (public) + route `/s/{slug}`.
- `backend/tests/test_media_token.py` — ajoute le round-trip share token.
- `backend/.env.example` — `PUBLIC_BASE_URL`, `PUBLIC_DIST_DIR`.

**Frontend (créés) :**
- `frontend/src/lib/shareLogic.ts` — logique pure (presets→expires_in, statut→libellé/couleur, format d'expiration).
- `frontend/src/lib/shareLogic.test.ts`.
- `frontend/src/screens/ShareSheet.tsx` — bottom sheet (configurer + lien prêt + liste des liens du réel).
- `frontend/src/screens/SharedLinksScreen.tsx` — vue globale « Liens partagés ».
- `frontend/public-share.html` — entrée HTML du bundle public.
- `frontend/src/public/main.tsx` — point d'entrée du bundle public.
- `frontend/src/public/PublicShareApp.tsx` — page destinataire (4 états).
- `frontend/src/public/publicApi.ts` — fetch minimal isolé (pas de Supabase).
- `frontend/src/public/isolation.test.ts` — garde-fou : aucun import Supabase/auth.

**Frontend (modifiés) :**
- `frontend/src/lib/types.ts` — types des liens.
- `frontend/src/lib/api.ts` — client des liens (authed).
- `frontend/src/lib/api.test.ts` — tests du client.
- `frontend/src/components/Icons.tsx` — ajoute `share`, `lock`, `globe`, `infinity`.
- `frontend/src/screens/MediaActionSheet.tsx` — ligne « Partager » dans le sheet `more`.
- `frontend/src/screens/PlayerScreen.tsx` + `GalleryScreen.tsx` — état share + ouverture du ShareSheet.
- `frontend/src/screens/AccountSheet.tsx` — entrée « Liens partagés ».
- `frontend/src/App.tsx` — route `shared-links` + passage de `onShare`.
- `frontend/vite.config.ts` — entrée de build `public-share.html`.

---

## Task 1: Migration `0005_shares.sql`

**Files:**
- Create: `supabase/migrations/0005_shares.sql`

- [ ] **Step 1: Écrire la migration**

```sql
-- Réelgram — liens de partage public (spec 2026-06-12)
create table if not exists public.shares (
  id             uuid primary key default gen_random_uuid(),
  video_id       uuid not null references public.videos(id) on delete cascade,
  user_id        uuid not null references auth.users(id)    on delete cascade,
  slug           text not null unique,
  password_hash  text,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  view_count     int  not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists shares_user_created_idx on public.shares (user_id, created_at desc);
create index if not exists shares_video_idx        on public.shares (video_id);

alter table public.shares enable row level security;
drop policy if exists "own shares" on public.shares;
create policy "own shares" on public.shares
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Vérifier la syntaxe SQL**

Run: `grep -c "create" supabase/migrations/0005_shares.sql`
Expected: au moins 3 (table + 2 index). La migration s'applique sur Supabase (manuel/CI) ; pas de test pytest (cohérent avec les migrations existantes).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_shares.sql
git commit -m "feat(db): table shares (lien public, RLS propriétaire, cascade vidéo)"
```

---

## Task 2: `shares.py` — logique pure (slug, PIN, expiration, statut, rate-limit)

**Files:**
- Create: `backend/app/shares.py`
- Test: `backend/tests/test_shares_unit.py`

- [ ] **Step 1: Écrire les tests**

```python
# backend/tests/test_shares_unit.py
import time
import pytest
from app import shares


def test_new_slug_is_urlsafe_and_long():
    s = shares.new_slug()
    assert len(s) >= 20
    assert "/" not in s and "+" not in s and "=" not in s
    assert shares.new_slug() != shares.new_slug()  # aléatoire


def test_password_hash_roundtrip():
    h = shares.hash_password("4821")
    assert h.startswith("pbkdf2_sha256$")
    assert shares.verify_password("4821", h) is True
    assert shares.verify_password("0000", h) is False


def test_verify_password_handles_none():
    # pas de hash stocké -> aucun mot de passe requis
    assert shares.verify_password("whatever", None) is False


@pytest.mark.parametrize("code,seconds", [("24h", 86400), ("7d", 7 * 86400), ("30d", 30 * 86400)])
def test_expires_at_presets(code, seconds):
    now = 1_000_000
    exp = shares.expires_at_from(code, now=now)
    assert exp == now + seconds


def test_expires_at_permanent_is_none():
    assert shares.expires_at_from(None, now=1_000_000) is None


def test_expires_at_rejects_unknown():
    with pytest.raises(ValueError):
        shares.expires_at_from("99y", now=0)


def test_status_active_expired_revoked():
    now = 2_000
    assert shares.share_status({"expires_at": None, "revoked_at": None}, now=now) == "active"
    assert shares.share_status({"expires_at": now + 10, "revoked_at": None}, now=now) == "active"
    assert shares.share_status({"expires_at": now - 10, "revoked_at": None}, now=now) == "expired"
    assert shares.share_status({"expires_at": None, "revoked_at": now - 1}, now=now) == "revoked"


def test_rate_limiter_blocks_after_max():
    rl = shares.RateLimiter(max_attempts=3, window_seconds=100)
    key = "slug-x:1.2.3.4"
    assert all(rl.allow(key, now=0) for _ in range(3))
    assert rl.allow(key, now=0) is False          # 4e bloqué
    assert rl.allow(key, now=200) is True          # fenêtre écoulée
```

- [ ] **Step 2: Lancer les tests (échec attendu)**

Run: `cd backend && python -m pytest tests/test_shares_unit.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.shares'`

- [ ] **Step 3: Implémenter `shares.py`**

```python
# backend/app/shares.py
"""Logique pure des liens de partage : slug, PIN (pbkdf2), expiration, statut.

Aucun accès DB ici — ce module est trivialement testable. Les helpers DB vivent
dans ``supa.py`` ; les routes dans ``main.py``.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time as _time
from typing import Optional

# Presets d'expiration exposés au client (cf. spec §Décisions).
EXPIRES_IN_SECONDS = {"24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}

_PBKDF2_ITER = 120_000


def new_slug() -> str:
    """Capability publique non devinable (~22 car., 128 bits, URL-safe sans '=')."""
    return secrets.token_urlsafe(16)


def hash_password(pin: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, _PBKDF2_ITER)
    return f"pbkdf2_sha256${_PBKDF2_ITER}${salt.hex()}${dk.hex()}"


def verify_password(pin: str, stored: Optional[str]) -> bool:
    if not stored:
        return False
    try:
        algo, iter_s, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), bytes.fromhex(salt_hex), int(iter_s))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk.hex(), hash_hex)


def expires_at_from(code: Optional[str], now: Optional[float] = None) -> Optional[int]:
    """Convertit un preset ('24h'/'7d'/'30d'/None) en epoch d'expiration (None=permanent)."""
    if code is None:
        return None
    if code not in EXPIRES_IN_SECONDS:
        raise ValueError(f"unknown expires_in: {code!r}")
    base = int(now if now is not None else _time.time())
    return base + EXPIRES_IN_SECONDS[code]


def _epoch(value) -> Optional[float]:
    """Normalise un timestamptz (ISO str | epoch | None) en epoch float ou None."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    # ISO 8601 venant de Supabase, ex. '2026-06-19T12:00:00+00:00'
    from datetime import datetime
    s = str(value).replace("Z", "+00:00")
    return datetime.fromisoformat(s).timestamp()


def share_status(row: dict, now: Optional[float] = None) -> str:
    """'revoked' | 'expired' | 'active' à partir d'une ligne shares."""
    t = now if now is not None else _time.time()
    if _epoch(row.get("revoked_at")) is not None:
        return "revoked"
    exp = _epoch(row.get("expires_at"))
    if exp is not None and exp < t:
        return "expired"
    return "active"


class RateLimiter:
    """Limiteur mémoire simple (fenêtre glissante). Suffisant pour un mono-process."""

    def __init__(self, max_attempts: int, window_seconds: int) -> None:
        self.max = max_attempts
        self.window = window_seconds
        self._hits: dict[str, list[float]] = {}

    def allow(self, key: str, now: Optional[float] = None) -> bool:
        t = now if now is not None else _time.time()
        hits = [h for h in self._hits.get(key, []) if h > t - self.window]
        if len(hits) >= self.max:
            self._hits[key] = hits
            return False
        hits.append(t)
        self._hits[key] = hits
        return True
```

- [ ] **Step 4: Lancer les tests (succès attendu)**

Run: `cd backend && python -m pytest tests/test_shares_unit.py -q`
Expected: PASS (tous les tests verts)

- [ ] **Step 5: Commit**

```bash
git add backend/app/shares.py backend/tests/test_shares_unit.py
git commit -m "feat(api): shares.py — slug, PIN pbkdf2, expiration, statut, rate-limit"
```

---

## Task 3: `media.py` — share view-token

**Files:**
- Modify: `backend/app/media.py`
- Test: `backend/tests/test_media_token.py`

- [ ] **Step 1: Ajouter les tests au fichier existant**

```python
# à AJOUTER à la fin de backend/tests/test_media_token.py
def test_share_token_roundtrip(monkeypatch):
    monkeypatch.setenv("MEDIA_TOKEN_SECRET", "s3cret-key-für-tests-1234567890ab")
    from app.config import get_settings
    get_settings.cache_clear()
    t = media.sign_share_token("slug-abc", ttl=60)
    assert media.verify_share_token(t) == "slug-abc"


def test_share_token_expired(monkeypatch):
    monkeypatch.setenv("MEDIA_TOKEN_SECRET", "s3cret-key-für-tests-1234567890ab")
    from app.config import get_settings
    get_settings.cache_clear()
    t = media.sign_share_token("slug-abc", ttl=-1)
    with pytest.raises(media.MediaTokenError):
        media.verify_share_token(t)


def test_media_token_not_accepted_as_share_token(monkeypatch):
    # séparation des domaines : un token média (vid/uid) ne vaut pas un share token
    monkeypatch.setenv("MEDIA_TOKEN_SECRET", "s3cret-key-für-tests-1234567890ab")
    from app.config import get_settings
    get_settings.cache_clear()
    mt = media.sign_media_token("vid", "uid", ttl=60)
    with pytest.raises(media.MediaTokenError):
        media.verify_share_token(mt)
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `cd backend && python -m pytest tests/test_media_token.py -q`
Expected: FAIL — `AttributeError: module 'app.media' has no attribute 'sign_share_token'`

- [ ] **Step 3: Implémenter dans `media.py`**

Ajoute ces fonctions après `verify_media_token` (réutilise `_b64url_encode`, `_sign`, `_b64url_decode`, `MediaTokenError` déjà présents) :

```python
def sign_share_token(slug: str, ttl: int = 3600) -> str:
    """Token public lié à un slug de partage (domaine distinct du token média)."""
    payload = {"sslug": slug, "exp": int(time.time()) + ttl}
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{payload_b64}.{_sign(payload_b64)}"


def verify_share_token(token: str) -> str:
    try:
        payload_b64, sig = token.split(".", 1)
    except ValueError as exc:
        raise MediaTokenError("malformed token") from exc
    if not hmac.compare_digest(_sign(payload_b64), sig):
        raise MediaTokenError("bad signature")
    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except (ValueError, json.JSONDecodeError) as exc:
        raise MediaTokenError("bad payload") from exc
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)) or exp < time.time():
        raise MediaTokenError("expired")
    slug = payload.get("sslug")
    if not slug:
        raise MediaTokenError("not a share token")
    return slug
```

- [ ] **Step 4: Lancer (succès attendu)**

Run: `cd backend && python -m pytest tests/test_media_token.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/media.py backend/tests/test_media_token.py
git commit -m "feat(api): media.py — view-token de partage lié au slug"
```

---

## Task 4: `supa.py` helpers + `models.py` schémas

**Files:**
- Modify: `backend/app/supa.py`, `backend/app/models.py`

Pas de test dédié : les helpers `supa` sont monkeypatchés dans les tests de routes (Tasks 5–7), comme le reste du module.

- [ ] **Step 1: Ajouter les helpers dans `supa.py`** (après la section videos)

```python
# --- shares -----------------------------------------------------------------

def get_video_service(video_id: str) -> Optional[dict]:
    """Fetch a video by id WITHOUT user scoping (pour les chemins publics, après
    résolution d'un share). À n'utiliser qu'avec un video_id issu d'une ligne shares."""
    res = get_client().table("videos").select("*").eq("id", video_id).limit(1).execute()
    return res.data[0] if res.data else None


def insert_share(user_id: str, video_id: str, slug: str,
                 password_hash: Optional[str], expires_at_iso: Optional[str]) -> dict:
    payload = {
        "user_id": user_id, "video_id": video_id, "slug": slug,
        "password_hash": password_hash, "expires_at": expires_at_iso,
    }
    res = get_client().table("shares").insert(payload).execute()
    return res.data[0]


def list_shares_for_video(video_id: str, user_id: str) -> list[dict]:
    res = (get_client().table("shares").select("*")
           .eq("video_id", video_id).eq("user_id", user_id)
           .order("created_at", desc=True).execute())
    return res.data or []


def list_shares_for_user(user_id: str) -> list[dict]:
    """Liens + champs du réel joints, pour la vue globale."""
    res = (get_client().table("shares")
           .select("*, videos(id,title,thumb_color,media_type)")
           .eq("user_id", user_id).order("created_at", desc=True).execute())
    return res.data or []


def get_share_by_slug(slug: str) -> Optional[dict]:
    res = get_client().table("shares").select("*").eq("slug", slug).limit(1).execute()
    return res.data[0] if res.data else None


def revoke_share(share_id: str, user_id: str, iso: str) -> None:
    (get_client().table("shares").update({"revoked_at": iso})
     .eq("id", share_id).eq("user_id", user_id).execute())


def increment_share_view(share_id: str, count: int, iso: str) -> None:
    """Best-effort : pose view_count + last_viewed_at (count = valeur déjà incrémentée)."""
    (get_client().table("shares")
     .update({"view_count": count, "last_viewed_at": iso}).eq("id", share_id).execute())
```

- [ ] **Step 2: Ajouter les schémas dans `models.py`**

```python
class ShareCreate(BaseModel):
    expires_in: Optional[str] = None   # '24h' | '7d' | '30d' | None (permanent)
    password: Optional[str] = None


class ShareCreated(BaseModel):
    id: str
    slug: str
    url: str
    expires_at: Optional[str] = None
    has_password: bool = False


class ShareInfo(BaseModel):
    id: str
    slug: str
    url: str
    status: str                        # active | expired | revoked
    expires_at: Optional[str] = None
    has_password: bool = False
    view_count: int = 0
    created_at: str


class ShareVideoRef(BaseModel):
    id: str
    title: str
    thumb_color: Optional[str] = None
    media_type: str = "video"


class ShareGlobalInfo(ShareInfo):
    video: Optional[ShareVideoRef] = None


class PublicShareMeta(BaseModel):
    media_type: str = "video"
    title: str
    needs_password: bool = False
    expires_at: Optional[str] = None
    stream_url: Optional[str] = None
    slides: Optional[list[str]] = None
    thumb_url: Optional[str] = None


class ShareUnlock(BaseModel):
    password: str
```

- [ ] **Step 3: Vérifier l'import**

Run: `cd backend && python -c "from app import supa, models; print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add backend/app/supa.py backend/app/models.py
git commit -m "feat(api): supa helpers shares + schémas Pydantic des liens"
```

---

## Task 5: Router authentifié des liens (`/api/videos/{id}/shares`, `/api/shares`)

**Files:**
- Modify: `backend/app/main.py`, `backend/app/config.py`
- Test: `backend/tests/test_shares_api.py`

- [ ] **Step 1: Ajouter `public_base_url` à `config.py`**

Dans `Settings` ajoute le champ `public_base_url: str` (après `max_video_mb`) et, dans `load_settings()`, `public_base_url=os.environ.get("PUBLIC_BASE_URL", "")`. Ajoute aussi `public_dist_dir: Optional[str]` avec `public_dist_dir=os.environ.get("PUBLIC_DIST_DIR") or None` (servira en Task 7).

- [ ] **Step 2: Écrire les tests authed**

```python
# backend/tests/test_shares_api.py
import time
import jwt
import pytest
from fastapi.testclient import TestClient

JWT_SECRET = "jwt-secret-für-tests-abcdefghijklmnop"
MEDIA_SECRET = "media-secret-für-tests-1234567890abc"


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("MEDIA_TOKEN_SECRET", MEDIA_SECRET)
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://reelgram.test")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app.config import get_settings
    get_settings.cache_clear()
    return tmp_path


@pytest.fixture
def client(env):
    import app.main as main
    return TestClient(main.app)


def _auth(sub="user-1"):
    tok = jwt.encode({"sub": sub, "aud": "authenticated", "exp": int(time.time()) + 60},
                     JWT_SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {tok}"}


def test_create_share_requires_ready_video(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_video", lambda vid, user_id=None: {"id": vid, "status": "fetching"})
    r = client.post("/api/videos/v1/shares", json={"expires_in": "7d"}, headers=_auth())
    assert r.status_code == 400


def test_create_share_unknown_video_404(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_video", lambda vid, user_id=None: None)
    r = client.post("/api/videos/v1/shares", json={"expires_in": "7d"}, headers=_auth())
    assert r.status_code == 404


def test_create_share_returns_url_and_persists(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_video", lambda vid, user_id=None: {"id": vid, "status": "ready"})
    captured = {}

    def fake_insert(user_id, video_id, slug, password_hash, expires_at_iso):
        captured.update(user_id=user_id, video_id=video_id, slug=slug,
                        password_hash=password_hash, expires_at_iso=expires_at_iso)
        return {"id": "sh1", "slug": slug, "expires_at": expires_at_iso}

    monkeypatch.setattr(supa, "insert_share", fake_insert)
    r = client.post("/api/videos/v1/shares", json={"expires_in": "7d", "password": "1234"},
                    headers=_auth(sub="owner-9"))
    assert r.status_code == 201
    body = r.json()
    assert body["url"].startswith("https://reelgram.test/s/")
    assert body["has_password"] is True
    assert captured["user_id"] == "owner-9"
    assert captured["password_hash"] and captured["password_hash"].startswith("pbkdf2_sha256$")
    assert captured["expires_at_iso"] is not None


def test_create_share_permanent_no_password(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_video", lambda vid, user_id=None: {"id": vid, "status": "ready"})
    monkeypatch.setattr(supa, "insert_share",
                        lambda u, v, slug, ph, exp: {"id": "sh", "slug": slug, "expires_at": exp})
    r = client.post("/api/videos/v1/shares", json={"expires_in": None}, headers=_auth())
    assert r.status_code == 201
    assert r.json()["expires_at"] is None
    assert r.json()["has_password"] is False


def test_list_shares_for_video(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "list_shares_for_video", lambda vid, uid: [
        {"id": "s1", "slug": "abc", "expires_at": None, "revoked_at": None,
         "password_hash": None, "view_count": 3, "created_at": "2026-06-12"},
    ])
    r = client.get("/api/videos/v1/shares", headers=_auth())
    assert r.status_code == 200
    row = r.json()[0]
    assert row["status"] == "active"
    assert row["has_password"] is False
    assert row["url"].endswith("/s/abc")
    assert "password_hash" not in row


def test_list_shares_global(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "list_shares_for_user", lambda uid: [
        {"id": "s1", "slug": "abc", "expires_at": None, "revoked_at": None,
         "password_hash": "x", "view_count": 0, "created_at": "2026-06-12",
         "videos": {"id": "v1", "title": "T", "thumb_color": "#fff", "media_type": "video"}},
    ])
    r = client.get("/api/shares", headers=_auth())
    assert r.status_code == 200
    row = r.json()[0]
    assert row["video"]["title"] == "T"
    assert row["has_password"] is True


def test_revoke_share(client, monkeypatch):
    from app import supa
    captured = {}
    monkeypatch.setattr(supa, "revoke_share",
                        lambda sid, uid, iso: captured.update(sid=sid, uid=uid))
    r = client.delete("/api/shares/sh-1", headers=_auth(sub="owner-2"))
    assert r.status_code == 204
    assert captured == {"sid": "sh-1", "uid": "owner-2"}


def test_create_share_requires_auth(client):
    r = client.post("/api/videos/v1/shares", json={"expires_in": "7d"})
    assert r.status_code == 401
```

- [ ] **Step 3: Lancer (échec attendu)**

Run: `cd backend && python -m pytest tests/test_shares_api.py -q`
Expected: FAIL — routes 404 (non encore montées).

- [ ] **Step 4: Implémenter le router authed dans `main.py`**

Ajoute les imports en tête : `from datetime import datetime, timezone` ; `from . import shares as shares_mod` ; et les modèles `ShareCreate, ShareCreated, ShareInfo, ShareGlobalInfo, ShareVideoRef`. Puis ajoute ce builder et monte-le dans `create_app()` (après `_build_videos_router`) :

```python
def _share_url(slug: str) -> str:
    base = get_settings().public_base_url.rstrip("/")
    return f"{base}/s/{slug}"


def _share_info(row: dict) -> dict:
    return {
        "id": row["id"], "slug": row["slug"], "url": _share_url(row["slug"]),
        "status": shares_mod.share_status(row),
        "expires_at": row.get("expires_at"),
        "has_password": bool(row.get("password_hash")),
        "view_count": row.get("view_count", 0),
        "created_at": str(row.get("created_at", "")),
    }


def _build_shares_router() -> APIRouter:
    router = APIRouter(tags=["shares"])

    @router.post("/videos/{video_id}/shares", response_model=ShareCreated, status_code=201)
    async def create_share(video_id: str, body: ShareCreate,
                           user_id: str = Depends(auth.resolve_user_jwt_only)):
        row = supa.get_video(video_id, user_id=user_id)
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        if row.get("status") != "ready":
            raise HTTPException(status_code=400, detail="Video not ready")
        try:
            exp = shares_mod.expires_at_from(body.expires_in)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid expires_in")
        exp_iso = datetime.fromtimestamp(exp, timezone.utc).isoformat() if exp else None
        pw_hash = shares_mod.hash_password(body.password) if body.password else None
        created = supa.insert_share(user_id, video_id, shares_mod.new_slug(), pw_hash, exp_iso)
        return ShareCreated(id=created["id"], slug=created["slug"], url=_share_url(created["slug"]),
                            expires_at=created.get("expires_at"), has_password=pw_hash is not None)

    @router.get("/videos/{video_id}/shares", response_model=list[ShareInfo])
    async def list_video_shares(video_id: str, user_id: str = Depends(auth.resolve_user_jwt_only)):
        return [_share_info(r) for r in supa.list_shares_for_video(video_id, user_id)]

    @router.get("/shares", response_model=list[ShareGlobalInfo])
    async def list_all_shares(user_id: str = Depends(auth.resolve_user_jwt_only)):
        out = []
        for r in supa.list_shares_for_user(user_id):
            info = _share_info(r)
            v = r.get("videos") or None
            if v:
                info["video"] = {"id": v["id"], "title": v.get("title", ""),
                                 "thumb_color": v.get("thumb_color"), "media_type": v.get("media_type", "video")}
            out.append(info)
        return out

    @router.delete("/shares/{share_id}", status_code=204)
    async def delete_share(share_id: str, user_id: str = Depends(auth.resolve_user_jwt_only)):
        supa.revoke_share(share_id, user_id, datetime.now(timezone.utc).isoformat())
        return Response(status_code=204)

    return router
```

Dans `create_app()`, ajoute `api.include_router(_build_shares_router())`.

- [ ] **Step 5: Lancer (succès attendu)**

Run: `cd backend && python -m pytest tests/test_shares_api.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py backend/app/config.py backend/tests/test_shares_api.py
git commit -m "feat(api): routes authentifiées des liens de partage (CRUD propriétaire)"
```

---

## Task 6: Router public (`/api/share/{slug}` resolve / unlock / média / og)

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_shares_api.py` (ajouts)

- [ ] **Step 1: Ajouter les tests publics**

```python
# à AJOUTER à backend/tests/test_shares_api.py
def _ready_share_row(slug="abc", password_hash=None, expires_at=None, revoked_at=None):
    return {"id": "sh1", "slug": slug, "user_id": "owner-1", "video_id": "v1",
            "password_hash": password_hash, "expires_at": expires_at,
            "revoked_at": revoked_at, "view_count": 0}


def test_public_resolve_no_password_returns_token_and_urls(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row())
    monkeypatch.setattr(supa, "get_video_service",
                        lambda vid: {"id": vid, "title": "Mon réel", "media_type": "video", "status": "ready"})
    monkeypatch.setattr(supa, "increment_share_view", lambda *a, **k: None)
    r = client.get("/api/share/abc")
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "Mon réel"
    assert body["needs_password"] is False
    assert "?t=" in body["stream_url"] and "/api/share/abc/stream" in body["stream_url"]


def test_public_resolve_with_password_hides_token(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_share_by_slug",
                        lambda slug: _ready_share_row(password_hash="pbkdf2_sha256$1$aa$bb"))
    monkeypatch.setattr(supa, "get_video_service",
                        lambda vid: {"id": vid, "title": "Secret", "media_type": "video", "status": "ready"})
    monkeypatch.setattr(supa, "increment_share_view", lambda *a, **k: None)
    r = client.get("/api/share/abc")
    assert r.status_code == 200
    body = r.json()
    assert body["needs_password"] is True
    assert body.get("stream_url") is None and body.get("slides") is None


def test_public_resolve_expired_410(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_share_by_slug",
                        lambda slug: _ready_share_row(expires_at="2000-01-01T00:00:00+00:00"))
    r = client.get("/api/share/abc")
    assert r.status_code == 410


def test_public_resolve_unknown_slug_404(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: None)
    assert client.get("/api/share/nope").status_code == 404


def test_public_unlock_success_then_fail(client, monkeypatch):
    from app import supa, shares
    pw_hash = shares.hash_password("4821")
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row(password_hash=pw_hash))
    monkeypatch.setattr(supa, "get_video_service",
                        lambda vid: {"id": vid, "title": "S", "media_type": "video", "status": "ready"})
    ok = client.post("/api/share/abc/unlock", json={"password": "4821"})
    assert ok.status_code == 200 and "?t=" in ok.json()["stream_url"]
    bad = client.post("/api/share/zzz1/unlock", json={"password": "0000"})  # slug différent => clé rate-limit distincte
    # mauvais mot de passe -> 403
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row(slug="zzz1", password_hash=pw_hash))
    assert client.post("/api/share/zzz1/unlock", json={"password": "0000"}).status_code == 403


def test_public_unlock_rate_limited(client, monkeypatch):
    from app import supa, shares, main
    pw_hash = shares.hash_password("4821")
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row(slug="rl1", password_hash=pw_hash))
    # 5 échecs autorisés puis 429
    codes = [client.post("/api/share/rl1/unlock", json={"password": "0000"}).status_code for _ in range(6)]
    assert codes[:5] == [403, 403, 403, 403, 403]
    assert codes[5] == 429


def test_public_stream_serves_media(client, env, monkeypatch):
    from app import supa, media
    # écrit un fichier vidéo réel dans DATA_DIR
    from app.config import get_settings
    s = get_settings()
    p = s.abs_path("videos/owner-1/v1.mp4"); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"PUBLIC-VIDEO-BYTES")
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row())
    monkeypatch.setattr(supa, "get_video_service",
                        lambda vid: {"id": vid, "storage_path": "videos/owner-1/v1.mp4", "status": "ready"})
    tok = media.sign_share_token("abc", ttl=60)
    r = client.get(f"/api/share/abc/stream?t={tok}")
    assert r.status_code == 200 and r.content == b"PUBLIC-VIDEO-BYTES"


def test_public_stream_token_for_other_slug_forbidden(client, env, monkeypatch):
    from app import supa, media
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row())
    tok = media.sign_share_token("other-slug", ttl=60)
    assert client.get(f"/api/share/abc/stream?t={tok}").status_code == 403


def test_public_og_thumb_no_password(client, env, monkeypatch):
    from app import supa
    from app.config import get_settings
    s = get_settings()
    tp = s.abs_path("thumbs/owner-1/v1.jpg"); tp.parent.mkdir(parents=True, exist_ok=True)
    tp.write_bytes(b"\xff\xd8thumb")
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row())
    monkeypatch.setattr(supa, "get_video_service",
                        lambda vid: {"id": vid, "thumb_path": "thumbs/owner-1/v1.jpg", "status": "ready"})
    r = client.get("/api/share/abc/og")
    assert r.status_code == 200 and r.content == b"\xff\xd8thumb"


def test_public_og_protected_share_404(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_share_by_slug",
                        lambda slug: _ready_share_row(password_hash="pbkdf2_sha256$1$aa$bb"))
    assert client.get("/api/share/abc/og").status_code == 404
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `cd backend && python -m pytest tests/test_shares_api.py -q -k public`
Expected: FAIL — routes 404.

- [ ] **Step 3: Implémenter le router public dans `main.py`**

Ajoute en tête `from .models import PublicShareMeta, ShareUnlock` et `SHARE_TOKEN_TTL = 3600`. Crée un rate-limiter module-level : `_unlock_rl = shares_mod.RateLimiter(max_attempts=5, window_seconds=900)`. Ajoute ce builder, monté dans `create_app()` :

```python
def _public_media_urls(slug: str, video: dict) -> dict:
    token = media.sign_share_token(slug, ttl=SHARE_TOKEN_TTL)
    thumb = f"/api/share/{slug}/thumb?t={token}"
    if video.get("media_type") == "image":
        slides = [f"/api/share/{slug}/slide/{m['i']}?t={token}" for m in (video.get("media") or [])]
        return {"slides": slides, "thumb_url": thumb}
    return {"stream_url": f"/api/share/{slug}/stream?t={token}", "thumb_url": thumb}


def _resolve_active_share(slug: str) -> dict:
    """Renvoie la ligne share si active ; 404 si inconnue, 410 si expirée/révoquée."""
    row = supa.get_share_by_slug(slug)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    status = shares_mod.share_status(row)
    if status != "active":
        raise HTTPException(status_code=410, detail="Link no longer active")
    return row


def _share_token_owner_slug(slug: str, t: str) -> None:
    try:
        tok_slug = media.verify_share_token(t)
    except media.MediaTokenError:
        raise HTTPException(status_code=403, detail="Invalid token")
    if tok_slug != slug:
        raise HTTPException(status_code=403, detail="Token not valid for this link")


def _build_public_share_router() -> APIRouter:
    router = APIRouter(prefix="/share", tags=["public-share"])

    @router.get("/{slug}", response_model=PublicShareMeta)
    async def resolve(slug: str):
        row = _resolve_active_share(slug)
        video = supa.get_video_service(row["video_id"])
        if not video:
            raise HTTPException(status_code=410, detail="Link no longer active")
        # compteur d'ouvertures (best-effort)
        try:
            supa.increment_share_view(row["id"], row.get("view_count", 0) + 1,
                                      datetime.now(timezone.utc).isoformat())
        except Exception:
            pass
        meta = {"media_type": video.get("media_type", "video"), "title": video.get("title", ""),
                "needs_password": bool(row.get("password_hash")), "expires_at": row.get("expires_at")}
        if not row.get("password_hash"):
            meta.update(_public_media_urls(slug, video))
        return PublicShareMeta(**meta)

    @router.post("/{slug}/unlock", response_model=PublicShareMeta)
    async def unlock(slug: str, body: ShareUnlock, request: Request):
        row = _resolve_active_share(slug)
        ip = request.client.host if request.client else "?"
        if not _unlock_rl.allow(f"{slug}:{ip}"):
            raise HTTPException(status_code=429, detail="Too many attempts")
        if not shares_mod.verify_password(body.password, row.get("password_hash")):
            raise HTTPException(status_code=403, detail="Wrong password")
        video = supa.get_video_service(row["video_id"])
        if not video:
            raise HTTPException(status_code=410, detail="Link no longer active")
        meta = {"media_type": video.get("media_type", "video"), "title": video.get("title", ""),
                "needs_password": True, "expires_at": row.get("expires_at")}
        meta.update(_public_media_urls(slug, video))
        return PublicShareMeta(**meta)

    @router.get("/{slug}/stream")
    async def stream(slug: str, request: Request, t: str = Query(...)):
        _share_token_owner_slug(slug, t)
        row = _resolve_active_share(slug)
        video = supa.get_video_service(row["video_id"])
        if not video or not video.get("storage_path"):
            raise HTTPException(status_code=404, detail="Not found")
        path = get_settings().abs_path(video["storage_path"])
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        return media.stream_file(path, request.headers.get("Range"), media_type="video/mp4")

    @router.get("/{slug}/slide/{i}")
    async def slide(slug: str, i: int, request: Request, t: str = Query(...)):
        _share_token_owner_slug(slug, t)
        row = _resolve_active_share(slug)
        video = supa.get_video_service(row["video_id"])
        if not video:
            raise HTTPException(status_code=404, detail="Not found")
        entry = next((m for m in (video.get("media") or []) if m.get("i") == i), None)
        if not entry or not entry.get("path"):
            raise HTTPException(status_code=404, detail="Slide not found")
        path = get_settings().abs_path(entry["path"])
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        _MIME = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                 "webp": "image/webp", "heic": "image/heic"}
        ext = entry["path"].lower().rsplit(".", 1)[-1] if "." in entry["path"] else ""
        return media.stream_file(path, request.headers.get("Range"), media_type=_MIME.get(ext, "image/jpeg"))

    @router.get("/{slug}/thumb")
    async def thumb(slug: str, request: Request, t: str = Query(...)):
        _share_token_owner_slug(slug, t)
        row = _resolve_active_share(slug)
        video = supa.get_video_service(row["video_id"])
        if not video or not video.get("thumb_path"):
            raise HTTPException(status_code=404, detail="Not found")
        path = get_settings().abs_path(video["thumb_path"])
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        return media.stream_file(path, request.headers.get("Range"), media_type="image/jpeg")

    @router.get("/{slug}/og")
    async def og_thumb(slug: str, request: Request):
        # vignette d'aperçu SANS token, scopée slug — uniquement si pas de mot de passe.
        row = _resolve_active_share(slug)
        if row.get("password_hash"):
            raise HTTPException(status_code=404, detail="Protected")
        video = supa.get_video_service(row["video_id"])
        if not video or not video.get("thumb_path"):
            raise HTTPException(status_code=404, detail="Not found")
        path = get_settings().abs_path(video["thumb_path"])
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        return media.stream_file(path, request.headers.get("Range"), media_type="image/jpeg")

    return router
```

Dans `create_app()`, ajoute `api.include_router(_build_public_share_router())`.

- [ ] **Step 4: Lancer (succès attendu)**

Run: `cd backend && python -m pytest tests/test_shares_api.py -q`
Expected: PASS (authed + public)

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_shares_api.py
git commit -m "feat(api): routes publiques de partage (resolve/unlock/média/og + rate-limit)"
```

---

## Task 7: Coquille publique `GET /s/{slug}` + meta OG

**Files:**
- Modify: `backend/app/main.py`, `backend/.env.example`
- Test: `backend/tests/test_shares_api.py` (ajouts)

- [ ] **Step 1: Ajouter les tests de la coquille**

```python
# à AJOUTER à backend/tests/test_shares_api.py
def test_shell_injects_og_meta_no_password(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_share_by_slug", lambda slug: _ready_share_row())
    monkeypatch.setattr(supa, "get_video_service",
                        lambda vid: {"id": vid, "title": "Routine épaules", "media_type": "video", "status": "ready"})
    r = client.get("/s/abc")
    assert r.status_code == 200
    html = r.text
    assert "Routine épaules" in html
    assert 'property="og:image"' in html
    assert "https://reelgram.test/api/share/abc/og" in html


def test_shell_protected_uses_generic_og(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_share_by_slug",
                        lambda slug: _ready_share_row(password_hash="pbkdf2_sha256$1$aa$bb"))
    monkeypatch.setattr(supa, "get_video_service",
                        lambda vid: {"id": vid, "title": "Secret", "media_type": "video", "status": "ready"})
    r = client.get("/s/abc")
    assert r.status_code == 200
    assert "Réel protégé" in r.text
    assert "/api/share/abc/og" not in r.text   # pas de fuite de vignette


def test_shell_expired_410(client, monkeypatch):
    from app import supa
    monkeypatch.setattr(supa, "get_share_by_slug",
                        lambda slug: _ready_share_row(revoked_at="2000-01-01T00:00:00+00:00"))
    assert client.get("/s/abc").status_code == 410
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `cd backend && python -m pytest tests/test_shares_api.py -q -k shell`
Expected: FAIL — `/s/abc` non monté (404).

- [ ] **Step 3: Implémenter la coquille dans `main.py`**

Ajoute `import html as _html` en tête. Ajoute cette fonction + une route montée directement sur `app` (pas sous `/api`) dans `create_app()` :

```python
def _render_share_shell(slug: str, *, title: str, protected: bool, media_type: str) -> str:
    base = get_settings().public_base_url.rstrip("/")
    page_url = f"{base}/s/{slug}"
    safe_title = _html.escape(title or "Réelgram")
    if protected:
        og_title, og_desc = "Réel protégé · Réelgram", "Saisis le code pour voir ce réel."
        og_image_tag = ""
    else:
        og_title, og_desc = safe_title, "Partagé via Réelgram"
        og_image_tag = f'<meta property="og:image" content="{base}/api/share/{slug}/og">'
    # En prod, on injecte les meta dans le HTML buildé du bundle public si présent.
    dist = get_settings().public_dist_dir
    head_extra = (
        f'<meta property="og:title" content="{og_title}">'
        f'<meta property="og:description" content="{og_desc}">'
        f'<meta property="og:type" content="video.other">'
        f'<meta property="og:url" content="{page_url}">'
        f'{og_image_tag}'
        f'<meta name="twitter:card" content="summary_large_image">'
        f'<title>{og_title}</title>'
    )
    if dist:
        built = Path(dist) / "public-share.html"
        if built.exists():
            doc = built.read_text(encoding="utf-8")
            return doc.replace("</head>", head_extra + "</head>", 1)
    # Repli (dev/tests) : coquille minimale, toujours porteuse des meta OG.
    return (
        f'<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'{head_extra}</head><body><div id="root"></div>'
        f'<script type="module" src="/public-share.js"></script></body></html>'
    )
```

Dans `create_app()`, après `app.include_router(api)` :

```python
    from pathlib import Path  # si pas déjà importé en tête

    @app.get("/s/{slug}")
    async def share_shell(slug: str):
        row = supa.get_share_by_slug(slug)
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        if shares_mod.share_status(row) != "active":
            raise HTTPException(status_code=410, detail="Link no longer active")
        video = supa.get_video_service(row["video_id"]) or {}
        html_doc = _render_share_shell(
            slug, title=video.get("title", "Réelgram"),
            protected=bool(row.get("password_hash")), media_type=video.get("media_type", "video"),
        )
        from fastapi.responses import HTMLResponse
        return HTMLResponse(html_doc)
```

(Place `from pathlib import Path` en tête du module si absent.)

- [ ] **Step 4: Lancer (succès attendu)**

Run: `cd backend && python -m pytest tests/test_shares_api.py -q`
Expected: PASS

- [ ] **Step 5: Documenter `.env.example`**

Ajoute à `backend/.env.example` :

```
# URL publique de base pour construire les liens de partage (ex. https://reelgram.app)
PUBLIC_BASE_URL=
# Répertoire du frontend buildé (contient public-share.html) pour servir la coquille /s/<slug>
PUBLIC_DIST_DIR=
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py backend/.env.example
git commit -m "feat(api): coquille publique /s/{slug} avec meta OG par lien (générique si protégé)"
```

---

## Task 8: Client frontend + types (`api.ts`, `types.ts`)

**Files:**
- Modify: `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`
- Test: `frontend/src/lib/api.test.ts`

- [ ] **Step 1: Ajouter les types dans `types.ts`**

```typescript
export type ShareStatus = 'active' | 'expired' | 'revoked';
export type ShareExpiresIn = '24h' | '7d' | '30d' | null;

export interface ShareCreated {
  id: string;
  slug: string;
  url: string;
  expires_at: string | null;
  has_password: boolean;
}

export interface ShareInfo {
  id: string;
  slug: string;
  url: string;
  status: ShareStatus;
  expires_at: string | null;
  has_password: boolean;
  view_count: number;
  created_at: string;
}

export interface ShareGlobalInfo extends ShareInfo {
  video?: { id: string; title: string; thumb_color: string | null; media_type: MediaType };
}
```

- [ ] **Step 2: Écrire les tests du client (suivre le style de `api.test.ts`)**

Lis d'abord `frontend/src/lib/api.test.ts` pour le pattern de mock de `fetch`/config, puis ajoute :

```typescript
// à AJOUTER à frontend/src/lib/api.test.ts
import { createShare, listVideoShares, listAllShares, deleteShare } from './api';

describe('shares client', () => {
  it('createShare POST le payload et renvoie le lien', async () => {
    const body = { id: 's1', slug: 'abc', url: 'https://x/s/abc', expires_at: null, has_password: false };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 201, headers: { 'Content-Type': 'application/json' } }),
    );
    const r = await createShare('v1', { expires_in: '7d', password: '1234' });
    expect(r.slug).toBe('abc');
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain('/videos/v1/shares');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ expires_in: '7d', password: '1234' });
  });

  it('deleteShare DELETE le bon id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await deleteShare('sh-1');
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain('/shares/sh-1');
    expect(init.method).toBe('DELETE');
  });
});
```

- [ ] **Step 3: Lancer (échec attendu)**

Run: `cd frontend && npx vitest run src/lib/api.test.ts`
Expected: FAIL — `createShare` n'existe pas.

- [ ] **Step 4: Implémenter dans `api.ts`**

```typescript
// ---- shares (liens publics) -------------------------------------------------
import type { ShareCreated, ShareInfo, ShareGlobalInfo, ShareExpiresIn } from './types';

export interface ShareCreateInput {
  expires_in: ShareExpiresIn;
  password?: string | null;
}

/** Crée un lien de partage pour un réel. */
export function createShare(videoId: string, input: ShareCreateInput): Promise<ShareCreated> {
  const payload: { expires_in: ShareExpiresIn; password?: string } = { expires_in: input.expires_in };
  if (input.password) payload.password = input.password;
  return apiFetch<ShareCreated>(`/videos/${videoId}/shares`, { method: 'POST', json: payload });
}

/** Liste les liens d'un réel. */
export function listVideoShares(videoId: string): Promise<ShareInfo[]> {
  return apiFetch<ShareInfo[]>(`/videos/${videoId}/shares`);
}

/** Liste globale de tous les liens (vue Compte). */
export function listAllShares(): Promise<ShareGlobalInfo[]> {
  return apiFetch<ShareGlobalInfo[]>('/shares');
}

/** Révoque un lien. */
export function deleteShare(shareId: string): Promise<void> {
  return apiFetch<void>(`/shares/${shareId}`, { method: 'DELETE' });
}
```

(Place l'import en tête du fichier avec les autres imports de types.)

- [ ] **Step 5: Lancer (succès attendu)**

Run: `cd frontend && npx vitest run src/lib/api.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts frontend/src/lib/api.test.ts
git commit -m "feat(front): client + types des liens de partage"
```

---

## Task 9: Icônes (`share`, `lock`, `globe`, `infinity`)

**Files:**
- Modify: `frontend/src/components/Icons.tsx`

- [ ] **Step 1: Ajouter les icônes dans l'objet `Icons`** (avant la fermeture `} satisfies ...`)

```tsx
  share: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </Ico>
  ),
  lock: (p: IconProps) => (
    <Ico {...p}>
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Ico>
  ),
  globe: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5a13 13 0 0 1 0 17 13 13 0 0 1 0-17" />
    </Ico>
  ),
  infinity: (p: IconProps) => (
    <Ico {...p}>
      <path d="M6.5 9a3 3 0 1 0 0 6c1.6 0 2.7-1.2 3.5-2.5l1-1.5C15 9 16 9 17.5 9a3 3 0 1 1 0 6c-1.5 0-2.5 0-3.5-1.5" />
    </Ico>
  ),
```

- [ ] **Step 2: Vérifier la compilation TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Icons.tsx
git commit -m "feat(front): icônes share / lock / globe / infinity"
```

---

## Task 10: Logique pure du partage (`shareLogic.ts`)

**Files:**
- Create: `frontend/src/lib/shareLogic.ts`, `frontend/src/lib/shareLogic.test.ts`

- [ ] **Step 1: Écrire les tests**

```typescript
// frontend/src/lib/shareLogic.test.ts
import { describe, it, expect } from 'vitest';
import { EXPIRY_OPTIONS, statusBadge, formatExpiry } from './shareLogic';
import type { ShareInfo } from './types';

const base: ShareInfo = {
  id: 's', slug: 'a', url: 'u', status: 'active', expires_at: null,
  has_password: false, view_count: 0, created_at: '2026-06-12T00:00:00Z',
};

describe('EXPIRY_OPTIONS', () => {
  it('propose 24h/7d/30d/permanent avec la valeur API', () => {
    expect(EXPIRY_OPTIONS.map((o) => o.value)).toEqual(['24h', '7d', '30d', null]);
  });
});

describe('statusBadge', () => {
  it('permanent actif → libellé Permanent', () => {
    expect(statusBadge({ ...base, status: 'active', expires_at: null }).label).toBe('Permanent');
  });
  it('expiré → rouge', () => {
    expect(statusBadge({ ...base, status: 'expired' }).label).toBe('Expiré');
  });
  it('révoqué → libellé Révoqué', () => {
    expect(statusBadge({ ...base, status: 'revoked' }).label).toBe('Révoqué');
  });
  it('actif daté → "Expire dans …"', () => {
    const soon = new Date(Date.now() + 18 * 3600 * 1000).toISOString();
    expect(statusBadge({ ...base, status: 'active', expires_at: soon }).label).toMatch(/Expire/);
  });
});

describe('formatExpiry', () => {
  it('null → permanent', () => {
    expect(formatExpiry(null)).toMatch(/permanent/i);
  });
});
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `cd frontend && npx vitest run src/lib/shareLogic.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter `shareLogic.ts`**

```typescript
// frontend/src/lib/shareLogic.ts
// Logique pure des liens de partage (aucune dépendance React / réseau).
import type { ShareExpiresIn, ShareInfo } from './types';

export interface ExpiryOption {
  value: ShareExpiresIn;
  label: string;
}

/** Presets exposés dans le sheet (ordre d'affichage). Défaut = 7 jours (index 1). */
export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: null, label: 'Permanent' },
];

export const DEFAULT_EXPIRY: ShareExpiresIn = '7d';

export interface Badge {
  label: string;
  color: string;
}

const VIOLET = '#a78bfa';
const GREEN = '#5ee2a0';
const AMBER = '#ff9966';
const RED = '#ff8a96';

function relativeFromNow(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Expiré';
  const h = Math.round(ms / 3_600_000);
  if (h < 24) return `Expire ${h} h`;
  return `Expire ${Math.round(h / 24)} j`;
}

/** Pastille de statut (libellé + couleur), cohérente partout. */
export function statusBadge(s: ShareInfo): Badge {
  if (s.status === 'revoked') return { label: 'Révoqué', color: RED };
  if (s.status === 'expired') return { label: 'Expiré', color: RED };
  if (s.expires_at === null) return { label: 'Permanent', color: VIOLET };
  const ms = new Date(s.expires_at).getTime() - Date.now();
  const color = ms < 24 * 3_600_000 ? AMBER : GREEN;
  return { label: relativeFromNow(s.expires_at), color };
}

/** Résumé d'expiration pour l'état « lien prêt ». */
export function formatExpiry(expiresAt: string | null): string {
  if (expiresAt === null) return 'Lien permanent';
  const d = new Date(expiresAt);
  const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `Expire le ${date}`;
}
```

- [ ] **Step 4: Lancer (succès attendu)**

Run: `cd frontend && npx vitest run src/lib/shareLogic.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/shareLogic.ts frontend/src/lib/shareLogic.test.ts
git commit -m "feat(front): shareLogic — presets, pastille de statut, format d'expiration"
```

---

## Task 11: `ShareSheet.tsx` + branchement dans le menu ⋯

**Files:**
- Create: `frontend/src/screens/ShareSheet.tsx`
- Modify: `frontend/src/screens/MediaActionSheet.tsx`, `frontend/src/screens/PlayerScreen.tsx`, `frontend/src/screens/GalleryScreen.tsx`

- [ ] **Step 1: Créer `ShareSheet.tsx`**

```tsx
// frontend/src/screens/ShareSheet.tsx
// Bottom sheet de partage (même chrome que MediaActionSheet) : liste des liens
// du réel + création (configurer → lien prêt). navigator.share avec repli copie.
import { useCallback, useEffect, useState } from 'react';
import { Icons } from '../components/Icons';
import * as api from '../lib/api';
import type { ShareInfo, ShareExpiresIn } from '../lib/types';
import { EXPIRY_OPTIONS, DEFAULT_EXPIRY, statusBadge, formatExpiry } from '../lib/shareLogic';

export interface ShareSheetProps {
  videoId: string;
  videoTitle: string;
  onClose: () => void;
}

type Phase = { kind: 'list' } | { kind: 'configure' } | { kind: 'ready'; share: ShareInfo };

const sheetWrap: React.CSSProperties = {
  position: 'absolute', inset: 0, zIndex: 45, display: 'flex', flexDirection: 'column',
  justifyContent: 'flex-end', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)',
  animation: 'fadeBg 0.25s ease both',
};
const sheetBody: React.CSSProperties = {
  background: 'var(--bg-1)', borderRadius: '26px 26px 0 0', border: '1px solid var(--hairline)',
  borderBottom: 'none', padding: '10px 22px calc(env(safe-area-inset-bottom,0px) + 26px)',
  animation: 'sheetUp 0.36s var(--ease) both', boxShadow: '0 -20px 60px -20px rgba(0,0,0,0.8)',
  maxHeight: '88%', overflowY: 'auto',
};

export function ShareSheet({ videoId, videoTitle, onClose }: ShareSheetProps) {
  const [shares, setShares] = useState<ShareInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: 'list' });
  const [expiry, setExpiry] = useState<ShareExpiresIn>(DEFAULT_EXPIRY);
  const [withPassword, setWithPassword] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setShares(await api.listVideoShares(videoId)); }
    catch { /* garde la dernière liste connue */ }
    finally { setLoading(false); }
  }, [videoId]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Si aucun lien encore, ouvrir directement la configuration.
  useEffect(() => { if (!loading && shares.length === 0 && phase.kind === 'list') setPhase({ kind: 'configure' }); }, [loading, shares.length, phase.kind]);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const created = await api.createShare(videoId, {
        expires_in: expiry, password: withPassword && pin ? pin : null,
      });
      const info: ShareInfo = {
        id: created.id, slug: created.slug, url: created.url, status: 'active',
        expires_at: created.expires_at, has_password: created.has_password,
        view_count: 0, created_at: new Date().toISOString(),
      };
      setPin(''); setWithPassword(false); setExpiry(DEFAULT_EXPIRY);
      setPhase({ kind: 'ready', share: info });
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Création impossible');
    } finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    setShares((xs) => xs.filter((x) => x.id !== id));
    try { await api.deleteShare(id); } catch { void refresh(); }
  };

  const shareUrl = async (url: string) => {
    if (navigator.share) { try { await navigator.share({ url }); return; } catch { /* annulé */ } }
    try { await navigator.clipboard.writeText(url); } catch { /* contexte non sécurisé */ }
  };
  const copyUrl = async (url: string) => { try { await navigator.clipboard.writeText(url); } catch { /* */ } };

  return (
    <div onClick={onClose} style={sheetWrap}>
      <style>{`@keyframes fadeBg{from{opacity:0}to{opacity:1}}@keyframes sheetUp{from{transform:translateY(100%)}to{transform:none}}`}</style>
      <div onClick={(e) => e.stopPropagation()} style={sheetBody}>
        <div style={{ width: 40, height: 5, borderRadius: 999, background: 'var(--hairline-strong)', margin: '0 auto 18px' }} />

        {phase.kind === 'list' && (
          <>
            <h3 style={{ fontSize: 17, fontWeight: 680, marginBottom: 2 }}>Liens de ce réel</h3>
            <p style={{ fontSize: 12.5, color: 'var(--txt-2)', marginBottom: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{videoTitle}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {shares.map((s) => {
                const b = statusBadge(s);
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 11px', borderRadius: 14, background: 'var(--bg-2)', border: '1px solid var(--hairline)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 620, color: b.color }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: b.color }} />{b.label}
                      </span>
                      <div style={{ fontSize: 11, color: 'var(--txt-2)', marginTop: 4, display: 'flex', gap: 9, alignItems: 'center' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{s.view_count} vues</span>
                        {s.has_password && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icons.lock size={12} /> code</span>}
                      </div>
                    </div>
                    <button onClick={() => shareUrl(s.url)} aria-label="Partager le lien" style={iconBtn}><Icons.share size={15} /></button>
                    <button onClick={() => copyUrl(s.url)} aria-label="Copier le lien" style={iconBtn}><Icons.copy size={15} /></button>
                    <button onClick={() => revoke(s.id)} aria-label="Révoquer le lien" style={{ ...iconBtn, color: '#ff8a96' }}><Icons.trash size={15} /></button>
                  </div>
                );
              })}
            </div>
            <button onClick={() => setPhase({ kind: 'configure' })} style={newLinkBtn}><Icons.plus size={17} /> Nouveau lien</button>
          </>
        )}

        {phase.kind === 'configure' && (
          <>
            <h3 style={{ fontSize: 17, fontWeight: 680, marginBottom: 16 }}>Partager ce réel</h3>
            <p style={labelStyle}>Durée du lien</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
              {EXPIRY_OPTIONS.map((o) => {
                const sel = o.value === expiry;
                return (
                  <button key={o.label} onClick={() => setExpiry(o.value)} style={{
                    padding: '11px 0', borderRadius: 13, fontSize: 13.5, fontWeight: sel ? 700 : 560,
                    color: sel ? '#160d18' : 'var(--txt-1)', background: sel ? 'var(--grad-accent)' : 'var(--bg-3)',
                    border: '1px solid ' + (sel ? 'transparent' : 'var(--hairline)'),
                  }}>{o.label}</button>
                );
              })}
            </div>
            <button onClick={() => setWithPassword((v) => !v)} role="switch" aria-checked={withPassword}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px', borderRadius: 14, background: 'var(--bg-2)', border: '1px solid var(--hairline)', marginBottom: withPassword ? 10 : 20 }}>
              <Icons.lock size={17} style={{ color: 'var(--txt-1)' }} />
              <span style={{ flex: 1, textAlign: 'left', fontSize: 14, color: 'var(--txt-0)' }}>Protéger par un code</span>
              <span style={{ width: 44, height: 26, borderRadius: 999, background: withPassword ? 'var(--grad-accent)' : 'var(--bg-3)', border: '1px solid var(--hairline)', position: 'relative' }}>
                <span style={{ position: 'absolute', top: 2, left: withPassword ? 20 : 2, width: 20, height: 20, borderRadius: '50%', background: withPassword ? '#fff' : 'var(--txt-2)', transition: 'left .2s' }} />
              </span>
            </button>
            {withPassword && (
              <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" autoFocus placeholder="Code (ex. 4 chiffres)"
                style={{ width: '100%', height: 50, padding: '0 16px', borderRadius: 14, background: 'var(--bg-2)', border: '1px solid var(--hairline-strong)', color: 'var(--txt-0)', fontSize: 16, outline: 'none', marginBottom: 20 }} />
            )}
            {error && <p style={{ fontSize: 13, color: '#ff8a96', marginBottom: 10 }}>{error}</p>}
            <button className="btn-primary" disabled={busy || (withPassword && !pin)} onClick={create}>
              <Icons.share size={18} /> {busy ? 'Création…' : 'Créer le lien'}
            </button>
            {shares.length > 0 && <button className="btn-ghost" style={{ marginTop: 10 }} onClick={() => setPhase({ kind: 'list' })}>Voir les liens existants</button>}
          </>
        )}

        {phase.kind === 'ready' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(94,226,160,0.15)', color: '#5ee2a0', display: 'grid', placeItems: 'center' }}><Icons.check size={17} /></span>
              <b style={{ fontSize: 16, fontWeight: 680 }}>Lien créé</b>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 14px', borderRadius: 14, background: 'var(--bg-2)', border: '1px solid var(--hairline-strong)', marginBottom: 10 }}>
              <Icons.globe size={16} style={{ color: 'var(--txt-2)' }} />
              <span style={{ flex: 1, fontSize: 13, color: 'var(--txt-0)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{phase.share.url}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--txt-2)', marginBottom: 18 }}>
              <Icons.clock size={14} /> {formatExpiry(phase.share.expires_at)}{phase.share.has_password ? ' · code requis' : ' · sans code'}
            </div>
            <button className="btn-primary" onClick={() => shareUrl(phase.share.url)}><Icons.share size={18} /> Partager…</button>
            <button className="btn-ghost" style={{ marginTop: 10 }} onClick={() => copyUrl(phase.share.url)}><Icons.copy size={16} /> Copier le lien</button>
            <button onClick={() => setPhase({ kind: 'list' })} style={{ display: 'block', width: '100%', textAlign: 'center', marginTop: 14, fontSize: 12.5, color: 'var(--a-violet)', fontWeight: 600, background: 'none', border: 'none' }}>Gérer les liens de ce réel →</button>
          </>
        )}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--bg-3)', border: '1px solid var(--hairline)', color: 'var(--txt-1)', flex: '0 0 auto' };
const newLinkBtn: React.CSSProperties = { width: '100%', height: 48, marginTop: 14, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--a-violet)', background: 'rgba(167,139,250,0.1)', border: '1px dashed rgba(167,139,250,0.45)' };
const labelStyle: React.CSSProperties = { fontSize: 10.5, color: 'var(--txt-2)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 9px' };
```

- [ ] **Step 2: Ajouter « Partager » au sheet `more` de `MediaActionSheet.tsx`**

Ajoute `onShare?: () => void;` à `MediaActionSheetProps`, accepte-le dans la déstructuration, et remplace le bloc `type === 'more'` par :

```tsx
        {type === 'more' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <SheetRow icon={Icons.share} label="Partager" onClick={() => onShare?.()} />
          </div>
        )}
```

(Le placeholder précédent est supprimé. `Icons.share` est désormais disponible.)

- [ ] **Step 3: Brancher dans `PlayerScreen.tsx`**

Importe `ShareSheet` (`import { ShareSheet } from './ShareSheet';`). Ajoute un état `const [shareOpen, setShareOpen] = useState(false);`. Passe `onShare={() => { setSheet(null); setShareOpen(true); }}` au `MediaActionSheet`. Après le bloc `{sheet && <MediaActionSheet ... />}`, ajoute :

```tsx
      {shareOpen && <ShareSheet videoId={video.id} videoTitle={title} onClose={() => setShareOpen(false)} />}
```

- [ ] **Step 4: Brancher dans `GalleryScreen.tsx`** (mêmes 3 ajouts : import, état `shareOpen`, prop `onShare` sur `MediaActionSheet`, et le rendu `{shareOpen && <ShareSheet videoId={video.id} videoTitle={title} onClose={() => setShareOpen(false)} />}`).

- [ ] **Step 5: Vérifier compilation + tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: compile + tous les tests verts.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/ShareSheet.tsx frontend/src/screens/MediaActionSheet.tsx frontend/src/screens/PlayerScreen.tsx frontend/src/screens/GalleryScreen.tsx
git commit -m "feat(front): ShareSheet (configurer/lien prêt/liste) + entrée Partager dans le menu ⋯"
```

---

## Task 12: Vue globale `SharedLinksScreen.tsx` + branchement Compte

**Files:**
- Create: `frontend/src/screens/SharedLinksScreen.tsx`
- Modify: `frontend/src/screens/AccountSheet.tsx`, `frontend/src/App.tsx`

- [ ] **Step 1: Créer `SharedLinksScreen.tsx`**

```tsx
// frontend/src/screens/SharedLinksScreen.tsx
// Vue globale « Liens partagés » : tout ce qui est exposé publiquement.
import { useCallback, useEffect, useState } from 'react';
import { Icons } from '../components/Icons';
import { StatusBar } from '../components/StatusBar';
import * as api from '../lib/api';
import type { ShareGlobalInfo } from '../lib/types';
import { statusBadge } from '../lib/shareLogic';
import { gradientFromColor } from '../lib/color';

export interface SharedLinksScreenProps {
  onBack: () => void;
}

export function SharedLinksScreen({ onBack }: SharedLinksScreenProps) {
  const [links, setLinks] = useState<ShareGlobalInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setLinks(await api.listAllShares()); } catch { /* */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const revoke = async (id: string) => {
    setLinks((xs) => xs.filter((x) => x.id !== id));
    try { await api.deleteShare(id); } catch { void refresh(); }
  };

  const active = links.filter((l) => l.status === 'active');

  return (
    <div className="view view-enter" style={{ background: 'var(--bg-0)' }}>
      <StatusBar />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 14px' }}>
        <button onClick={onBack} aria-label="Retour" style={{ width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--bg-3)', border: '1px solid var(--hairline)', color: 'var(--txt-0)' }}><Icons.back size={18} /></button>
        <h1 style={{ flex: 1, fontSize: 19, fontWeight: 700 }}>Liens partagés</h1>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#5ee2a0', background: 'rgba(94,226,160,0.12)', border: '1px solid rgba(94,226,160,0.3)', padding: '4px 9px', borderRadius: 999 }}>{active.length} actifs</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 14px 24px' }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center' }}><span style={{ display: 'inline-block', width: 22, height: 22, borderRadius: '50%', border: '2.4px solid var(--hairline-strong)', borderTopColor: 'var(--a-violet)', animation: 'spin 0.7s linear infinite' }} /></div>
        ) : links.length === 0 ? (
          <p style={{ fontSize: 13.5, color: 'var(--txt-2)', textAlign: 'center', padding: 30 }}>Aucun lien partagé pour l'instant.</p>
        ) : links.map((l) => {
          const b = statusBadge(l);
          const g = gradientFromColor(l.video?.thumb_color ?? '#a78bfa');
          return (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 10, borderRadius: 16, background: 'var(--bg-2)', border: '1px solid var(--hairline)', marginBottom: 10 }}>
              <div style={{ width: 44, height: 58, borderRadius: 11, flex: '0 0 auto', border: '1px solid var(--hairline)', background: `linear-gradient(150deg, ${g[0]}, ${g[1]})` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 620, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.video?.title ?? 'Réel'}</div>
                <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: b.color }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: b.color }} />{b.label}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--txt-2)' }}>· {l.view_count} vues</span>
                </div>
              </div>
              <button onClick={() => revoke(l.id)} aria-label="Révoquer le lien" style={{ width: 34, height: 34, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--bg-3)', border: '1px solid var(--hairline)', color: '#ff8a96', flex: '0 0 auto' }}><Icons.trash size={15} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Ajouter l'entrée dans `AccountSheet.tsx`**

Ajoute `onSharedLinks: () => void;` à `AccountSheetProps`, accepte-le, et ajoute un bouton (juste avant la section Connexion / le bouton Déconnexion) :

```tsx
        <button onClick={onSharedLinks} style={{ marginTop: 22, width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', borderRadius: 16, background: 'var(--bg-1)', border: '1px solid var(--hairline)' }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--grad-accent-soft)', border: '1px solid var(--hairline)', display: 'grid', placeItems: 'center', color: 'var(--a-violet)', flex: '0 0 auto' }}><Icons.share size={19} /></div>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ fontSize: 15, fontWeight: 560, color: 'var(--txt-0)' }}>Liens partagés</div>
            <div style={{ fontSize: 12.5, color: 'var(--txt-2)', marginTop: 2 }}>Voir et révoquer ce qui est public</div>
          </div>
          <Icons.chevron size={18} style={{ color: 'var(--txt-2)' }} />
        </button>
```

- [ ] **Step 3: Brancher dans `App.tsx`**

Ajoute `'shared-links'` au type `Route`. Importe `SharedLinksScreen`. Passe `onSharedLinks={() => { setAccountOpen(false); go('shared-links'); }}` au `<AccountSheet>`. Ajoute le rendu de la route (à côté des autres `route === ...`) :

```tsx
        {route === 'shared-links' && (
          <SharedLinksScreen onBack={() => go('library')} />
        )}
```

- [ ] **Step 4: Vérifier compilation + tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: compile + verts.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/SharedLinksScreen.tsx frontend/src/screens/AccountSheet.tsx frontend/src/App.tsx
git commit -m "feat(front): vue globale Liens partagés + entrée dans Compte"
```

---

## Task 13: Bundle public isolé (page destinataire)

**Files:**
- Create: `frontend/public-share.html`, `frontend/src/public/main.tsx`, `frontend/src/public/PublicShareApp.tsx`, `frontend/src/public/publicApi.ts`, `frontend/src/public/isolation.test.ts`
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Écrire le test d'isolation**

```typescript
// frontend/src/public/isolation.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Garde-fou : aucun fichier du bundle public ne doit importer Supabase ou le
// module d'auth (sinon une session/JWT pourrait fuiter côté destinataire).
describe('isolation du bundle public', () => {
  it('aucun import de supabase / auth', () => {
    const dir = join(__dirname);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.tsx') && !f.endsWith('.ts')) continue;
      if (f.endsWith('.test.ts')) continue;
      const src = readFileSync(join(dir, f), 'utf-8');
      expect(src).not.toMatch(/@supabase\/supabase-js/);
      expect(src).not.toMatch(/lib\/supabase/);
      expect(src).not.toMatch(/lib\/auth/);
    }
  });
});
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `cd frontend && npx vitest run src/public/isolation.test.ts`
Expected: FAIL — dossier `src/public` inexistant.

- [ ] **Step 3: Créer `publicApi.ts`** (fetch minimal, aucune dépendance app)

```typescript
// frontend/src/public/publicApi.ts
const API = (window.__ENV__?.API_URL ?? '/api');

export interface PublicMeta {
  media_type: 'video' | 'image';
  title: string;
  needs_password: boolean;
  expires_at: string | null;
  stream_url?: string;
  slides?: string[];
  thumb_url?: string;
}

export type ResolveResult =
  | { state: 'ok'; meta: PublicMeta }
  | { state: 'password' }
  | { state: 'gone' }
  | { state: 'notfound' };

function slugFromPath(): string {
  const m = window.location.pathname.match(/\/s\/([^/?#]+)/);
  return m ? m[1] : '';
}

export async function resolveShare(): Promise<ResolveResult> {
  const slug = slugFromPath();
  if (!slug) return { state: 'notfound' };
  const res = await fetch(`${API}/share/${slug}`);
  if (res.status === 410) return { state: 'gone' };
  if (res.status === 404) return { state: 'notfound' };
  if (!res.ok) return { state: 'gone' };
  const meta = (await res.json()) as PublicMeta;
  return meta.needs_password ? { state: 'password' } : { state: 'ok', meta };
}

export async function unlockShare(password: string): Promise<PublicMeta | null> {
  const slug = slugFromPath();
  const res = await fetch(`${API}/share/${slug}/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  });
  if (!res.ok) return null;
  return (await res.json()) as PublicMeta;
}
```

(`window.__ENV__` est déjà typé globalement via `config.ts` ; le bundle public ne l'importe pas, donc redéclare le minimum si `tsc` se plaint : `declare global { interface Window { __ENV__?: { API_URL?: string } } }` en tête du fichier.)

- [ ] **Step 4: Créer `PublicShareApp.tsx`** (4 états, réutilise `color.ts`/`Icons` purs)

```tsx
// frontend/src/public/PublicShareApp.tsx
// Page destinataire : brandée, mobile-first. Réutilise des helpers PURS
// (gradientFromColor, Icons) — JAMAIS de composant couplé à l'auth.
import { useEffect, useRef, useState } from 'react';
import { Icons } from '../components/Icons';
import { resolveShare, unlockShare, type PublicMeta, type ResolveResult } from './publicApi';

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; meta: PublicMeta }
  | { kind: 'password'; error?: string }
  | { kind: 'gone' }
  | { kind: 'notfound' };

const ACCENT = 'linear-gradient(115deg,#ff7eb3 0%,#ff9966 48%,#a78bfa 100%)';

export function PublicShareApp() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    resolveShare().then((r: ResolveResult) => {
      if (r.state === 'ok') setView({ kind: 'ready', meta: r.meta });
      else if (r.state === 'password') setView({ kind: 'password' });
      else if (r.state === 'gone') setView({ kind: 'gone' });
      else setView({ kind: 'notfound' });
    }).catch(() => setView({ kind: 'gone' }));
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#060608', color: '#f4f4f6', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(85% 50% at 50% 22%, rgba(167,139,250,0.3), transparent 62%)', filter: 'blur(22px)' }} />
      <Wordmark />
      {view.kind === 'loading' && <Centered><Spinner /></Centered>}
      {view.kind === 'ready' && <ReadyView meta={view.meta} />}
      {view.kind === 'password' && <PasswordGate error={view.error} onUnlock={(m) => setView({ kind: 'ready', meta: m })} onError={(e) => setView({ kind: 'password', error: e })} />}
      {view.kind === 'gone' && <EdgeState icon={<Icons.clock size={28} />} title="Ce lien n'est plus actif" sub="Il a peut-être expiré ou été révoqué par son auteur." />}
      {view.kind === 'notfound' && <EdgeState icon={<Icons.globe size={28} />} title="Lien introuvable" sub="Vérifie l'adresse, ou demande un nouveau lien." />}
      <Footer />
    </div>
  );
}

function Wordmark() {
  return (
    <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '16px 0 12px' }}>
      <span style={{ width: 17, height: 17, borderRadius: 5, background: ACCENT }} />
      <span style={{ fontSize: 14.5, fontWeight: 740, background: ACCENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Réelgram</span>
    </div>
  );
}
function Footer() {
  return <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', padding: '14px 0 16px', fontSize: 11.5, color: '#76768a' }}>Partagé via Réelgram</div>;
}
function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'grid', placeItems: 'center' }}>{children}</div>;
}
function Spinner() {
  return <span style={{ width: 28, height: 28, borderRadius: '50%', border: '2.6px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} />;
}

function ReadyView({ meta }: { meta: PublicMeta }) {
  return meta.media_type === 'image'
    ? <Carousel slides={meta.slides ?? []} title={meta.title} />
    : <VideoView src={meta.stream_url ?? ''} title={meta.title} />;
}

function VideoView({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => { const el = ref.current; if (!el) return; el.paused ? void el.play().catch(() => {}) : el.pause(); };
  return (
    <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div onClick={toggle} style={{ position: 'relative', flex: 1, margin: '0 16px', borderRadius: 24, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)', background: '#000', boxShadow: '0 30px 60px -28px #000' }}>
        <video ref={ref} src={src} playsInline autoPlay onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        {!playing && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.25)' }}>
            <div style={{ width: 62, height: 62, borderRadius: '50%', background: 'rgba(10,10,12,0.42)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.24)', display: 'grid', placeItems: 'center' }}><Icons.play size={26} style={{ marginLeft: 3 }} /></div>
          </div>
        )}
      </div>
      <h1 style={{ margin: '14px 18px 0', fontSize: 16.5, fontWeight: 680, letterSpacing: '-0.01em' }}>{title}</h1>
    </div>
  );
}

function Carousel({ slides, title }: { slides: string[]; title: string }) {
  const [active, setActive] = useState(0);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };
  return (
    <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ position: 'relative', flex: 1, margin: '0 16px', borderRadius: 24, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
        <div onScroll={onScroll} style={{ display: 'flex', width: '100%', height: '100%', overflowX: 'auto', scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}>
          {slides.map((src, i) => (
            <div key={i} style={{ position: 'relative', flex: '0 0 100%', height: '100%', scrollSnapAlign: 'center', display: 'grid', placeItems: 'center' }}>
              <img src={src} alt="" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(28px) brightness(0.5)', transform: 'scale(1.2)' }} />
              <img src={src} alt={`Photo ${i + 1}`} style={{ position: 'relative', maxWidth: '92%', maxHeight: '100%', objectFit: 'contain', borderRadius: 16 }} />
            </div>
          ))}
        </div>
        {slides.length > 1 && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 14, display: 'flex', justifyContent: 'center', gap: 6 }}>
            {slides.map((_, i) => <span key={i} style={{ width: i === active ? 18 : 6, height: 6, borderRadius: 9, background: i === active ? '#fff' : 'rgba(255,255,255,0.4)', transition: 'all .2s' }} />)}
          </div>
        )}
      </div>
      <h1 style={{ margin: '14px 18px 0', fontSize: 16.5, fontWeight: 680 }}>{title}</h1>
    </div>
  );
}

function PasswordGate({ error, onUnlock, onError }: { error?: string; onUnlock: (m: PublicMeta) => void; onError: (e: string) => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const meta = await unlockShare(pin);
    setBusy(false);
    if (meta) onUnlock(meta); else onError('Code incorrect');
  };
  return (
    <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 28px', textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(167,139,250,0.14)', color: '#a78bfa', display: 'grid', placeItems: 'center', marginBottom: 18 }}><Icons.lock size={28} /></div>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 7 }}>Réel protégé</h3>
      <p style={{ fontSize: 13, color: '#b8b8c4', marginBottom: 18 }}>Saisis le code qu'on t'a communiqué pour voir ce réel.</p>
      <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" autoFocus placeholder="Code"
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        style={{ width: '100%', maxWidth: 240, height: 50, textAlign: 'center', borderRadius: 14, background: '#16161c', border: '1px solid rgba(255,255,255,0.14)', color: '#f4f4f6', fontSize: 18, outline: 'none', marginBottom: error ? 8 : 18 }} />
      {error && <p style={{ fontSize: 13, color: '#ff8a96', marginBottom: 14 }}>{error}</p>}
      <button disabled={busy || !pin} onClick={submit} style={{ width: '100%', maxWidth: 240, height: 50, borderRadius: 15, fontSize: 15, fontWeight: 660, color: '#160d18', background: ACCENT, border: 'none' }}>{busy ? '…' : 'Voir le réel'}</button>
    </div>
  );
}

function EdgeState({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 28px', textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#1e1e26', color: '#76768a', display: 'grid', placeItems: 'center', marginBottom: 18 }}>{icon}</div>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 7 }}>{title}</h3>
      <p style={{ fontSize: 13, color: '#b8b8c4' }}>{sub}</p>
    </div>
  );
}
```

- [ ] **Step 5: Créer `main.tsx`**

```tsx
// frontend/src/public/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicShareApp } from './PublicShareApp';
import '../styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><PublicShareApp /></StrictMode>,
);
```

- [ ] **Step 6: Créer `public-share.html`**

```html
<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Réelgram</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/public/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Déclarer l'entrée dans `vite.config.ts`**

Ajoute `import { resolve } from 'node:path';` en tête et un bloc `build` dans `defineConfig` :

```typescript
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'public-share': resolve(__dirname, 'public-share.html'),
      },
    },
  },
```

- [ ] **Step 8: Lancer le test d'isolation + build**

Run: `cd frontend && npx vitest run src/public/isolation.test.ts && npx tsc --noEmit`
Expected: PASS + aucune erreur de type.

- [ ] **Step 9: Vérifier que le build produit les deux entrées**

Run: `cd frontend && npx vite build && ls dist/public-share.html`
Expected: `dist/public-share.html` existe.

- [ ] **Step 10: Commit**

```bash
git add frontend/public-share.html frontend/src/public frontend/vite.config.ts
git commit -m "feat(front): bundle public isolé (page destinataire vidéo/carrousel/code/inactif)"
```

---

## Task 14: Vérification d'ensemble

**Files:** aucun (vérification).

- [ ] **Step 1: Suite backend complète**

Run: `cd backend && python -m pytest -q`
Expected: tous les tests verts (existants + nouveaux).

- [ ] **Step 2: Suite frontend complète + types + build**

Run: `cd frontend && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: types OK, tests verts, build OK avec `dist/public-share.html`.

- [ ] **Step 3: Commit (si ajustements)**

```bash
git add -A && git commit -m "test: vérification d'ensemble du partage public"
```

---

## Self-Review (rempli par l'auteur du plan)

**Couverture spec :** table `shares` (T1) ✓ · slug/PIN/expiration/statut (T2) ✓ · view-token (T3) ✓ · helpers DB + schémas (T4) ✓ · CRUD authed propriétaire (T5) ✓ · resolve/unlock/média/og + rate-limit + fuite OG (T6) ✓ · coquille `/s/{slug}` + OG par lien (T7) ✓ · client+types front (T8) ✓ · icônes (T9) ✓ · logique pure UI (T10) ✓ · ShareSheet + entrée ⋯ (T11) ✓ · vue globale + Compte (T12) ✓ · bundle public isolé 4 états + multi-entrée Vite + test isolation (T13) ✓ · vérif d'ensemble (T14) ✓. Cascade suppression réel = FK (T1). Périmètre vidéo + carrousel couvert (T6 média/slide, T13 Carousel).

**Placeholders :** aucun TBD/TODO ; code complet à chaque étape de code.

**Cohérence des types :** `expires_in` ('24h'|'7d'|'30d'|null) identique backend (`ShareCreate`/`shares.expires_at_from`) et front (`ShareExpiresIn`/`EXPIRY_OPTIONS`). `status` ∈ {active,expired,revoked} partagé (`share_status` ↔ `ShareStatus`/`statusBadge`). `view_token` payload `sslug` cohérent entre `sign_share_token`/`verify_share_token`/`_share_token_owner_slug`. Routes média publiques `/api/share/{slug}/stream|slide|thumb|og` cohérentes entre `_public_media_urls` et les handlers.
