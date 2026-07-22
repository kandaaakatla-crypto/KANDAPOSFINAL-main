"""Platform Owner authentication for Kanda POS.

This is the **SaaS-owner** auth path — completely separate from the per-store
staff PIN flow. It uses email + password (bcrypt) + TOTP 2FA (pyotp).

Two-step login:
  1. POST /api/owner/auth/login  {email, password}
       → on success returns a 5-minute "pre_2fa" JWT + {totp_required: True}.
  2. POST /api/owner/auth/verify  {code}, Authorization: Bearer <pre_2fa>
       → returns the long-lived (12h) access JWT.

The access JWT carries `role: "PlatformOwner"` and `iss: "owner"`. The
`get_current_owner` dependency rejects tokens that lack those claims.
"""
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt
import pyotp
from fastapi import Request, HTTPException

from db import get_db


JWT_ALG = "HS256"
ACCESS_TOKEN_HOURS = 12
PRE2FA_TOKEN_MINUTES = 5
ISSUER = "owner"


def _secret() -> str:
    return os.environ["JWT_SECRET"]


# ---------- password ----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, h: str) -> bool:
    return bcrypt.checkpw(pw.encode("utf-8"), h.encode("utf-8"))


# ---------- TOTP ----------
def new_totp_secret() -> str:
    return pyotp.random_base32()


def verify_totp(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    # Test-only escape hatch so automated UI/E2E suites can complete the 2FA
    # step without a real authenticator. Gated on an env flag that is NEVER
    # set in production. The fixed code `000000` is intentionally chosen so
    # it cannot collide with a real 6-digit TOTP issued for `secret`.
    if os.environ.get("OWNER_TOTP_TEST_BYPASS", "").lower() in ("1", "true", "yes") and code.strip() == "000000":
        return True
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def provisioning_uri(secret: str, email: str, issuer: str = "Kanda POS") -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)


# ---------- JWTs ----------
def _encode(payload: dict) -> str:
    return jwt.encode(payload, _secret(), algorithm=JWT_ALG)


def create_pre2fa_token(owner_id: str) -> str:
    return _encode({
        "sub": owner_id,
        "iss": ISSUER,
        "type": "pre_2fa",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=PRE2FA_TOKEN_MINUTES),
    })


def create_owner_access_token(owner_id: str) -> str:
    return _encode({
        "sub": owner_id,
        "iss": ISSUER,
        "role": "PlatformOwner",
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_HOURS),
    })


def create_impersonation_token(owner_id: str, tenant_id: str, target_user: dict, mode: str) -> str:
    """Mint a tenant-scoped JWT so a Platform Owner can act as / audit a tenant.

    mode = "full"     → behaves like a real tenant Manager session.
    mode = "auditor"  → carries auditor=True; the middleware blocks all writes
                        except /api/payments/verify.
    Both expire in 30 minutes.
    """
    return _encode({
        "sub": target_user["id"],
        "iss": ISSUER,
        "tenant_id": tenant_id,
        "role": target_user["role"],
        "type": "access",
        "imp": True,
        "imp_owner": owner_id,
        "auditor": mode == "auditor",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
    })


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _secret(), algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------- FastAPI dependencies ----------
def _bearer(request: Request) -> str:
    h = request.headers.get("Authorization", "")
    if not h.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return h[7:]


async def get_owner_pre2fa(request: Request) -> dict:
    payload = decode_token(_bearer(request))
    if payload.get("iss") != ISSUER or payload.get("type") != "pre_2fa":
        raise HTTPException(status_code=401, detail="Invalid pre-2FA token")
    db = get_db()
    owner = await db.platform_owners.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0, "totp_secret": 0})
    if not owner:
        raise HTTPException(status_code=401, detail="Owner not found")
    return owner


async def get_current_owner(request: Request) -> dict:
    payload = decode_token(_bearer(request))
    if payload.get("iss") != ISSUER or payload.get("role") != "PlatformOwner" or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Not an owner session")
    db = get_db()
    owner = await db.platform_owners.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0, "totp_secret": 0})
    if not owner:
        raise HTTPException(status_code=401, detail="Owner not found")
    return owner


# ---------- bootstrap ----------
async def create_owner(db, email: str, password: str, name: str = "Owner") -> dict:
    """Insert a new Platform Owner row. Generates a TOTP secret. Idempotent on email."""
    import uuid
    email = email.lower().strip()
    existing = await db.platform_owners.find_one({"email": email})
    if existing:
        return existing
    secret = new_totp_secret()
    doc = {
        "id": f"po_{uuid.uuid4().hex[:10]}",
        "email": email,
        "name": name,
        "password_hash": hash_password(password),
        "totp_secret": secret,
        "totp_enabled": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.platform_owners.insert_one(doc)
    await db.platform_owners.create_index("email", unique=True)
    return doc
