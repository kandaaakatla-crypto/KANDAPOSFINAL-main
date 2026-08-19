"""Database client + collection accessors."""
import os
import certifi
from motor.motor_asyncio import AsyncIOMotorClient

_client: AsyncIOMotorClient | None = None
_db = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        # tlsCAFile is required against MongoDB Atlas from a minimal Docker
        # image (python:3.11-slim, used by backend/Dockerfile) — the image's
        # default CA store doesn't negotiate TLS with Atlas cleanly and
        # fails with "SSL handshake failed: ... TLSV1_ALERT_INTERNAL_ERROR"
        # before authentication is even reached. certifi's bundle is the
        # standard fix; harmless against a local unencrypted mongod too,
        # since it's only consulted when the connection string uses TLS.
        _client = AsyncIOMotorClient(os.environ["MONGO_URL"], tlsCAFile=certifi.where())
    return _client


def get_db():
    global _db
    if _db is None:
        _db = get_client()[os.environ["DB_NAME"]]
    return _db


async def close():
    global _client
    if _client is not None:
        _client.close()
        _client = None
