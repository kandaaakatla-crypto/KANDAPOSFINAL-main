"""Shared fixtures for Andromeda POS backend tests."""
import os
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

# Load frontend .env (which has REACT_APP_BACKEND_URL)
load_dotenv(Path("/app/frontend/.env"))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"


@pytest.fixture(scope="session")
def base_url():
    assert BASE_URL.startswith("http"), "REACT_APP_BACKEND_URL not configured"
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth_token(api_client, base_url):
    r = api_client.post(f"{base_url}/auth/login", json={"pin": "1234"})
    if r.status_code != 200:
        pytest.skip(f"Login failed: {r.status_code} {r.text}")
    return r.json()["token"]


@pytest.fixture(scope="session")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture
def authed(api_client, auth_headers):
    """Session with auth header attached (scoped to test)."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", **auth_headers})
    return s
