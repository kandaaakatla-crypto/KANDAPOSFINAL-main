"""Regression test for the SPA soft-404 fix.

Firebase Hosting serves the React app shell (index.html) with HTTP 200 for
*any* path that isn't a real static asset or an explicitly listed app route
— including a dead link or typo'd URL — because the static rewrite has no
way to know which paths are "valid" client-side routes. Search engines flag
this as a soft-404. The fix adds a Hosting rewrite that forwards genuinely
unmatched paths to this backend instead of the static shell, and this
backend now answers those with a real 404 status (see server.py's
spa_soft_404_handler). These tests hit the FastAPI app directly — the same
path Firebase Hosting's new catch-all "run" rewrite takes in production —
without needing a live Hosting deploy to verify the response shape.
"""


def test_unknown_path_gets_html_not_the_default_json_404(client):
    resp = client.get("/this-path-does-not-exist-at-all")
    assert resp.status_code == 404
    assert "text/html" in resp.headers["content-type"]
    # The stock Starlette 404 body — this must NOT be what callers see.
    assert resp.text.strip() != '{"detail":"Not Found"}'


def test_unmatched_api_path_still_returns_the_normal_json_404(client):
    resp = client.get("/api/this-endpoint-does-not-exist")
    assert resp.status_code == 404
    assert "application/json" in resp.headers["content-type"]


def test_wrong_method_on_a_real_route_is_untouched(client):
    # 405s must keep going through the normal JSON error path — only a true
    # unmatched-route 404 gets the HTML swap.
    resp = client.post("/healthz")
    assert resp.status_code == 405
    assert "application/json" in resp.headers["content-type"]
