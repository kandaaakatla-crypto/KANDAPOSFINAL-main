"""Regression test for a platform-audit finding (2026-09-06): the API sent
`Access-Control-Allow-Origin: *` together with
`Access-Control-Allow-Credentials: true` on the same response — a
spec-invalid combination (browsers refuse to expose a credentialed
response read under a literal wildcard origin). The app doesn't actually
use cookie-based auth anywhere (it's Bearer-token-only), so credentials
were never needed on these responses in the first place.
"""


def test_wildcard_origin_is_never_paired_with_allow_credentials(client):
    r = client.get(
        "/api/tenant/public-info",
        headers={"Origin": "https://example.com"},
    )
    allow_origin = r.headers.get("access-control-allow-origin")
    allow_credentials = r.headers.get("access-control-allow-credentials")
    if allow_origin == "*":
        assert allow_credentials != "true", (
            "wildcard Access-Control-Allow-Origin must never be paired with "
            "Access-Control-Allow-Credentials: true"
        )
