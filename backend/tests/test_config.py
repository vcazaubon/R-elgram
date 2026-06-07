import os, tempfile
import jwt
from app.config import Settings, service_role_key_issue
from pathlib import Path


def test_abs_path_confined(tmp_path):
    s = Settings(supabase_url="", supabase_service_role_key="", supabase_jwt_secret="",
                 media_token_secret="x", data_dir=tmp_path, ig_cookies_file=None, max_video_mb=300)
    assert s.abs_path("videos/u/v.mp4") == (tmp_path / "videos/u/v.mp4").resolve()
    import pytest
    with pytest.raises(ValueError):
        s.abs_path("../../etc/passwd")
    with pytest.raises(ValueError):
        s.abs_path("/etc/passwd")


def _role_jwt(role):
    return jwt.encode({"role": role, "ref": "proj"}, "irrelevant", algorithm="HS256")


# --- service-role key sanity guard (defense in depth against the classic
#     "anon key pasted into SUPABASE_SERVICE_ROLE_KEY" misconfig that makes the
#     backend run under RLS → every row hidden → "Unknown category"). ---------

def test_service_key_flags_anon_jwt():
    # The exact bug we hit in prod: a role=anon JWT in the service-role slot.
    issue = service_role_key_issue(_role_jwt("anon"))
    assert issue is not None
    assert "anon" in issue


def test_service_key_flags_publishable():
    assert service_role_key_issue("sb_publishable_ABCDEF123456") is not None


def test_service_key_accepts_service_role_jwt():
    assert service_role_key_issue(_role_jwt("service_role")) is None


def test_service_key_accepts_secret_key():
    assert service_role_key_issue("sb_secret_ABCDEF123456") is None


def test_service_key_tolerates_empty_and_opaque():
    # Empty (dev/import-only) and opaque placeholders are not *provably* wrong.
    assert service_role_key_issue("") is None
    assert service_role_key_issue("service-role-key") is None
