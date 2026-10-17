"""Push notifications to the Kanda Driver app via Firebase Cloud Messaging
(HTTP v1 API).

Setup:
  - `FCM_SERVICE_ACCOUNT_JSON` env — the full JSON of a Firebase service
    account with the "Firebase Cloud Messaging API Admin" role. The project
    id is read from it. Unset means push is off and every call is a no-op;
    the driver app still alerts with in-app sound/vibration and local
    notifications while it's open or in the background.
  - The Android app needs the same Firebase project's google-services.json
    at frontend/android-driver/app/google-services.json (see
    docs/build/driver-app.md).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Iterable, Optional

logger = logging.getLogger("kanda.push")

_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_credentials = None


def _load_credentials():
    global _credentials
    raw = os.environ.get("FCM_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        return None
    if _credentials is None:
        from google.oauth2 import service_account
        info = json.loads(raw)
        _credentials = service_account.Credentials.from_service_account_info(info, scopes=[_SCOPE])
    return _credentials


def push_configured() -> bool:
    return bool(os.environ.get("FCM_SERVICE_ACCOUNT_JSON", "").strip())


def _access_token() -> Optional[str]:
    creds = _load_credentials()
    if creds is None:
        return None
    if not creds.valid:
        from google.auth.transport.requests import Request
        creds.refresh(Request())
    return creds.token


async def send_push(tokens: Iterable[str], title: str, body: str, data: Optional[dict] = None) -> int:
    """Send one notification to each device token. Returns how many FCM
    accepted. Never raises — a failed push must not fail the order write
    that triggered it."""
    tokens = [t for t in dict.fromkeys(tokens) if t]
    if not tokens or not push_configured():
        return 0
    try:
        access = await asyncio.to_thread(_access_token)
        project = _load_credentials().project_id
    except Exception as exc:  # noqa: BLE001
        logger.warning("FCM credentials failed: %s", exc)
        return 0

    import httpx
    url = f"https://fcm.googleapis.com/v1/projects/{project}/messages:send"
    headers = {"Authorization": f"Bearer {access}"}
    sent = 0
    async with httpx.AsyncClient(timeout=10) as client:
        for token in tokens:
            message = {
                "token": token,
                "notification": {"title": title, "body": body},
                "data": {k: str(v) for k, v in (data or {}).items()},
                "android": {"priority": "high", "notification": {"channel_id": "deliveries", "sound": "default"}},
            }
            try:
                r = await client.post(url, headers=headers, json={"message": message})
                if r.status_code == 200:
                    sent += 1
                else:
                    logger.info("FCM rejected a token (%s): %s", r.status_code, r.text[:200])
            except Exception as exc:  # noqa: BLE001
                logger.warning("FCM send failed: %s", exc)
    return sent
