"""Fixed-window rate limiter for security-sensitive endpoints (currently
just staff PIN login). Counts are meant to track FAILURES only — callers
should check `peek()` before processing a request and call `hit()` only
after a failed attempt, so legitimate repeated *correct* logins (common on
a shared POS terminal across a shift) never count against the limit.

Uses Redis for a cross-instance-consistent count when REDIS_URL is
configured (the production/multi-instance case); falls back to an
in-process dict otherwise (local dev, or a brief Redis outage). Unlike
cache.py's other call sites, a rate limiter that silently does nothing
when Redis is unavailable would be a silent security regression, not just
a perf one — so this never fully disables itself, it just becomes
per-instance instead of global.
"""
import time
from typing import Dict, Tuple

from cache import get_redis

_local_counts: Dict[str, Tuple[int, float]] = {}


async def peek(key: str) -> int:
    """Returns the current count for `key` without recording a new hit."""
    r = get_redis()
    if r is not None:
        try:
            raw = await r.get(key)
            return int(raw) if raw is not None else 0
        except Exception:
            pass
    count, expires_at = _local_counts.get(key, (0, 0.0))
    if time.monotonic() >= expires_at:
        return 0
    return count


async def hit(key: str, window_seconds: int) -> int:
    """Records one hit for `key`, starting a new window_seconds window if
    this is the first hit since the last one expired. Returns the count
    after this hit."""
    r = get_redis()
    if r is not None:
        try:
            count = await r.incr(key)
            if count == 1:
                await r.expire(key, window_seconds)
            return count
        except Exception:
            pass
    now = time.monotonic()
    count, expires_at = _local_counts.get(key, (0, 0.0))
    if now >= expires_at:
        count, expires_at = 0, now + window_seconds
    count += 1
    _local_counts[key] = (count, expires_at)
    return count
