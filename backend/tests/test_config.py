import os, tempfile
from app.config import Settings
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
