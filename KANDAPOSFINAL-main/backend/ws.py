"""Realtime WebSocket pub/sub for Kanda POS.

Connections are scoped per tenant — events for `xyzpizza` never reach `abcrest`
clients even if both are open in the same browser session. JWT is provided via
the `token` query string parameter at the time of connection, and the
`tenant_id` claim inside it pins the socket's channel.

Event shape: `{ "type": "<event>", "data": {...} }`

Cross-instance delivery: when REDIS_URL is set (see cache.py), broadcasts are
published to a per-tenant Redis channel instead of being delivered directly,
and redis_subscriber_loop() (started from server.py's startup hook) is the
one place that actually pushes to local WebSocket clients — including on the
instance that published, which receives its own message back over its own
subscription. That "publish, never deliver-and-publish" split is what keeps
delivery from doubling up on the origin instance. Without REDIS_URL, this
collapses back to today's single-instance direct-delivery behavior.
"""
import asyncio
import json
import logging
from typing import Any, Dict
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from auth import decode_token
from cache import get_redis


logger = logging.getLogger("kanda.ws")

ws_router = APIRouter()

_CHANNEL_PREFIX = "ws:"


class _Manager:
    def __init__(self) -> None:
        # ws → tenant_id, scoped to sockets connected to *this* instance only
        self._clients: Dict[WebSocket, str] = {}
        self._lock = asyncio.Lock()

    async def add(self, ws: WebSocket, tenant_id: str) -> None:
        async with self._lock:
            self._clients[ws] = tenant_id

    async def remove(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.pop(ws, None)

    async def deliver_local(self, event_type: str, data: Any, tenant_id: str) -> None:
        payload = {"type": event_type, "data": data}
        async with self._lock:
            dead = []
            for ws, t in list(self._clients.items()):
                if t != tenant_id:
                    continue
                try:
                    await ws.send_json(payload)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                self._clients.pop(ws, None)

    async def broadcast(self, event_type: str, data: Any, tenant_id: str) -> None:
        r = get_redis()
        if r is None:
            await self.deliver_local(event_type, data, tenant_id)
            return
        try:
            await r.publish(
                _CHANNEL_PREFIX + tenant_id,
                json.dumps({"type": event_type, "data": data}),
            )
        except Exception:
            # Redis hiccup — degrade to this instance's local clients rather
            # than dropping the event entirely.
            logger.warning("ws publish failed for tenant %s", tenant_id, exc_info=True)
            await self.deliver_local(event_type, data, tenant_id)


manager = _Manager()


def schedule_broadcast(event_type: str, data: Any, tenant_id: str) -> None:
    """Fire-and-forget tenant-scoped broadcast from async call sites."""
    try:
        asyncio.create_task(manager.broadcast(event_type, data, tenant_id))
    except RuntimeError:
        pass


async def redis_subscriber_loop() -> None:
    """Background task, started once from server.py's startup hook. No-op
    when REDIS_URL isn't set — get_redis() latches its answer for the life of
    the process, so a one-time check here is enough. Reconnects on any pubsub
    error instead of exiting, since this has to keep running for the whole
    life of the instance for cross-instance realtime delivery to work."""
    r = get_redis()
    if r is None:
        return
    while True:
        try:
            pubsub = r.pubsub()
            await pubsub.psubscribe(_CHANNEL_PREFIX + "*")
            async for message in pubsub.listen():
                if message.get("type") != "pmessage":
                    continue
                tenant_id = message["channel"][len(_CHANNEL_PREFIX):]
                try:
                    payload = json.loads(message["data"])
                except (TypeError, ValueError):
                    continue
                await manager.deliver_local(payload.get("type"), payload.get("data"), tenant_id)
        except Exception:
            logger.warning("ws redis subscriber loop error, reconnecting in 5s", exc_info=True)
            await asyncio.sleep(5)


@ws_router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    token = websocket.query_params.get("token") or ""
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise ValueError("not an access token")
        tenant_id = payload.get("tenant_id")
        if not tenant_id:
            raise ValueError("missing tenant_id claim")
    except Exception:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    await manager.add(websocket, tenant_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"ws error: {e}")
    finally:
        await manager.remove(websocket)


@ws_router.websocket("/ws/kds")
async def kds_ws_endpoint(websocket: WebSocket):
    """Public KDS websocket — authenticates via the long-lived `kds_token` on
    the tenant doc. The kitchen tablet joins the same per-tenant fan-out pool
    so it sees order.upserted / kds.ticket / kds.updated events in real time."""
    from db import get_db
    tok = websocket.query_params.get("token") or ""
    if not tok:
        await websocket.close(code=4401)
        return
    db = get_db()
    tenant = await db.tenants.find_one({"kds_token": tok}, {"_id": 0, "id": 1})
    if not tenant:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    await manager.add(websocket, tenant["id"])
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"kds ws error: {e}")
    finally:
        await manager.remove(websocket)
