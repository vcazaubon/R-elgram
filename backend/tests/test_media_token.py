import time, pytest
from app import media


def test_sign_verify_roundtrip(monkeypatch):
    monkeypatch.setenv("MEDIA_TOKEN_SECRET", "s3cret-key-für-tests-1234567890ab")
    from app.config import get_settings
    get_settings.cache_clear()
    t = media.sign_media_token("vid1", "usr1", ttl=60)
    vid, uid = media.verify_media_token(t)
    assert (vid, uid) == ("vid1", "usr1")


def test_expired(monkeypatch):
    monkeypatch.setenv("MEDIA_TOKEN_SECRET", "s3cret-key-für-tests-1234567890ab")
    from app.config import get_settings
    get_settings.cache_clear()
    t = media.sign_media_token("v", "u", ttl=-1)
    with pytest.raises(media.MediaTokenError):
        media.verify_media_token(t)


def test_tampered(monkeypatch):
    monkeypatch.setenv("MEDIA_TOKEN_SECRET", "s3cret-key-für-tests-1234567890ab")
    from app.config import get_settings
    get_settings.cache_clear()
    t = media.sign_media_token("v", "u", ttl=60)
    with pytest.raises(media.MediaTokenError):
        media.verify_media_token(t[:-2] + "xy")


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
    monkeypatch.setenv("MEDIA_TOKEN_SECRET", "s3cret-key-für-tests-1234567890ab")
    from app.config import get_settings
    get_settings.cache_clear()
    mt = media.sign_media_token("vid", "uid", ttl=60)
    with pytest.raises(media.MediaTokenError):
        media.verify_share_token(mt)
