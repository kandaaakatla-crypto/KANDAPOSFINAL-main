"""Smoke-test the Twilio Media Streams ↔ OpenAI Realtime bridge.

We pretend to be Twilio: open the public WSS, send a `start` event with the
demo tenant's custom params, then sit idle for a few seconds and verify that:
1. Our backend accepts the connection.
2. The backend opens a connection to OpenAI Realtime.
3. The backend sends back at least one `media` event (the assistant's
   initial greeting), proving the round-trip works.
"""
import asyncio
import base64
import json
import os
import sys

import websockets


WSS = "wss://api.kandapos.com/api/voice/twilio-stream"


async def main():
    print(f"Connecting to {WSS} ...")
    async with websockets.connect(WSS, ping_interval=20) as ws:
        print("Connected. Sending fake Twilio 'start' event...")
        await ws.send(json.dumps({
            "event": "start",
            "sequenceNumber": "1",
            "start": {
                "streamSid": "MZtest1234567890abcdef",
                "accountSid": os.environ.get("TWILIO_ACCOUNT_SID", ""),
                "callSid": "CAtestxyz",
                "tracks": ["inbound"],
                "mediaFormat": {"encoding": "audio/x-mulaw", "sampleRate": 8000, "channels": 1},
                "customParameters": {
                    "tenant_id": "demo",
                    "call_sid": "CAtestxyz",
                    "from_number": "+14155551234",
                    "to_number": "+19086498077",
                },
            },
            "streamSid": "MZtest1234567890abcdef",
        }))

        # Listen for ~12 s and collect events.
        media_frames = 0
        other_events: list[str] = []
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=15)
                try:
                    evt = json.loads(raw)
                except Exception:
                    print("Non-JSON frame:", raw[:120]); continue
                ev = evt.get("event") or evt.get("type") or "?"
                if ev == "media":
                    media_frames += 1
                    if media_frames in (1, 5, 25):
                        payload_len = len(evt.get("media", {}).get("payload", ""))
                        print(f"  media frame #{media_frames} (payload_b64_len={payload_len})")
                else:
                    other_events.append(ev)
                    print(f"  event: {ev}  body={str(evt)[:160]}")
                if media_frames >= 50:
                    print("Received enough media frames — bridge is working ✅")
                    break
        except asyncio.TimeoutError:
            print(f"\nTimeout after 15s. Media frames received: {media_frames}")
            print(f"Other events: {other_events}")
        await ws.close()

    print(f"\nFINAL: media_frames={media_frames}")
    if media_frames > 0:
        print("PASS ✅  — assistant audio is flowing back through the bridge")
        sys.exit(0)
    else:
        print("FAIL ❌  — no media frames received")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
