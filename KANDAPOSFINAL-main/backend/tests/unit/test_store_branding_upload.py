"""Regression test for PR #31's QR branding upload: a corrupt or truncated
image must be rejected as bad input (400), not crash the handler (500).
Pillow raises OSError from img.load() for a truncated file, which the
original handler didn't catch."""
import io

from PIL import Image

DEMO_MANAGER_PIN = "1234"


def _manager_headers(client):
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN},
                    headers={"X-Forwarded-For": "203.0.113.80"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _jpeg(size=(800, 800)):
    buf = io.BytesIO()
    Image.new("RGB", size, "red").save(buf, "JPEG")
    return buf.getvalue()


def test_truncated_image_is_rejected_with_400(client):
    headers = _manager_headers(client)
    truncated = _jpeg()[:2000]
    r = client.post("/api/tenant/store/branding", headers=headers,
                    data={"field": "logo"},
                    files={"file": ("logo.jpg", truncated, "image/jpeg")})
    assert r.status_code == 400, r.text


def test_valid_image_is_stored_as_webp(client):
    headers = _manager_headers(client)
    r = client.post("/api/tenant/store/branding", headers=headers,
                    data={"field": "logo"},
                    files={"file": ("logo.jpg", _jpeg(), "image/jpeg")})
    assert r.status_code == 200, r.text
    assert r.json()["logo_url"].startswith("data:image/webp;base64,")
