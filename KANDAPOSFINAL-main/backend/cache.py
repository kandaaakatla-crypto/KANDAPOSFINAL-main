"""Redis-backed cache, shared by the auth user-lookup cache, the menu cache,
and ws.py's cross-instance pub/sub. Deliberately optional: every call site
degrades to "always miss" / "single-instance direct delivery" when REDIS_URL
isn't set, so local dev and any environment without Redis provisioned keep
working exactly as before this existed — Redis is a scaling optimization,
never a hard runtime dependency.
"""
import json
import logging
import os
from typing import Any, Optional

import redis.asyncio as redis

logger = logging.getLogger("kanda.cache")

_client: Optional["redis.Redis"] = None
_checked = False


def get_redis() -> Optional["redis.Redis"]:
    global _client, _checked
    if not _checked:
        _checked = True
        url = os.environ.get("REDIS_URL")
        if url:
            try:
                _client = redis.from_url(url, decode_responses=True)
            except Exception:
                # from_url() parses/validates eagerly and can raise on a bad
                # URL before any network call — e.g. a misconfigured secret.
                # Must not crash the first caller (redis_subscriber_loop on
                # startup, or a real request's cache_get/cache_set); log and
                # stay in no-op mode like every other failure mode here.
                logger.error("get_redis: failed to construct client from REDIS_URL", exc_info=True)
    return _client


async def cache_get(key: str) -> Any:
    r = get_redis()
    if r is None:
        return None
    try:
        raw = await r.get(key)
        return json.loads(raw) if raw is not None else None
    except Exception:
        # A Redis hiccup should degrade to "cache miss", never break the request.
        logger.warning("cache_get failed for %s", key, exc_info=True)
        return None


async def cache_set(key: str, value: Any, ttl: int) -> None:
    r = get_redis()
    if r is None:
        return
    try:
        await r.set(key, json.dumps(value), ex=ttl)
    except Exception:
        logger.warning("cache_set failed for %s", key, exc_info=True)


async def cache_delete(*keys: str) -> None:
    r = get_redis()
    if r is None or not keys:
        return
    try:
        await r.delete(*keys)
    except Exception:
        logger.warning("cache_delete failed for %s", keys, exc_info=True)
