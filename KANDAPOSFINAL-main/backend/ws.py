"""Realtime WebSocket pub/sub for Kanda POS.

Connections are scoped per tenant — events for `xyzpizza` never reach `abcrest`
clients even if both are open in the same browser session. JWT is provided via
the `token` query string parameter at the time of connection, and the
`tenant_id` claim inside it pins the socket's channel.

Event shape: `{ "type": "<event>", "data": {...} }`
"""
import asyncio
import logging
from typing import Any, Dict
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from auth import decode_token


logger = logging.getLogger("kanda.ws")

ws_router = APIRouter()


class _Manager:
    def __init__(self) -> None:
        # ws → tenant_id
        self._clients: Dict[WebSocket, str] = {}
        self._lock = asyncio.Lock()

    async def add(self, ws: WebSocket, tenant_id: str) -> None:
        async with self._lock:
            self._clients[ws] = tenant_id

    async def remove(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.pop(ws, None)

    async def broadcast(self, event_type: str, data: Any, tenant_id: str) -> None:
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


manager = _Manager()


def schedule_broadcast(event_type: str, data: Any, tenant_id: str) -> None:
    """Fire-and-forget tenant-scoped broadcast from async call sites."""
    try:
        asyncio.create_task(manager.broadcast(event_type, data, tenant_id))
    except RuntimeError:
        pass


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
