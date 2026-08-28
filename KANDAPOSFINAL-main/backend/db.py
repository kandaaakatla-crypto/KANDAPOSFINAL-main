"""Database client + collection accessors."""
import os
import certifi
from motor.motor_asyncio import AsyncIOMotorClient

_client: AsyncIOMotorClient | None = None
_db = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        url = os.environ["MONGO_URL"]
        # maxPoolSize is explicit, not the driver default (100), because it
        # has to be sized against Atlas's per-tier connection ceiling times
        # however many Cloud Run instances are running concurrently — left
        # at 100, a handful of instances scaling out under load can exhaust
        # a free-tier (M0) cluster's ~500 total connection budget on driver
        # pools alone, before counting a single real request.
        kwargs = {"maxPoolSize": 20}
        # tlsCAFile is required against MongoDB Atlas from a minimal Docker
        # image (python:3.11-slim, used by backend/Dockerfile) — the image's
        # default CA store doesn't negotiate TLS with Atlas cleanly and
        # fails with "SSL handshake failed: ... TLSV1_ALERT_INTERNAL_ERROR"
        # before authentication is even reached. certifi's bundle is the
        # standard fix.
        #
        # NOT harmless against a local/CI unencrypted mongod, despite what an
        # earlier version of this comment claimed: passing tlsCAFile as a
        # kwarg makes pymongo enable TLS regardless of the URL scheme, so a
        # plain `mongodb://` client would attempt a TLS handshake against a
        # server with no TLS listener and fail with "SSL handshake received
        # but server is started without SSL support" — caught by PR 1's test
        # harness running against the mongo:7 CI service, which is exactly
        # the kind of thing static analysis (the original audit) can't see.
        # Atlas connection strings are always mongodb+srv://, so gate on that.
        if url.startswith("mongodb+srv://"):
            kwargs["tlsCAFile"] = certifi.where()
        _client = AsyncIOMotorClient(url, **kwargs)
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
