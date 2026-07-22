# Biometric / external clock-in integration

Kanda POS's time clock is **PIN + selfie** out of the box. The same backend
endpoint accepts punches from any future device — biometric, QR scanner,
RFID — as long as the device produces an HTTP POST that matches the
contract below. No code changes are required to add a new device class;
write a small adapter that talks to the device and forwards punches.

## The contract

```http
POST /api/timeclock/punch
Content-Type: application/json
X-Tenant-Slug: <slug>

{
  "pin":         "1234",       // 4-digit numeric PIN of the employee
  "selfie_b64":  "data:image/jpeg;base64,...",  // optional, ~20 KB jpg recommended
  "device_id":   "ZK-LOBBY-01", // freeform string identifying the device
  "location_id": "loc_xxx"      // optional — for multi-location tenants
}
```

The server auto-detects whether the punch is `in` or `out` by inspecting
the employee's most recent punch. It records the punch with
`source: "pin"` (override per device class via the adapter — see below).

Response:
```json
{
  "id": "tp_...", "user_id": "u_...", "user_name": "Aarav Reddy",
  "type": "in", "at": "2026-02-25T08:01:43+00:00", "source": "pin"
}
```

## ZKTeco / ESSL (de-facto open-protocol fingerprint terminals)

These devices speak the **ZK protocol** which is fully reverse-engineered
in the open-source [`pyzk`](https://github.com/fananimi/pyzk) library
(MIT license). Recommended adapter pattern:

```python
# /opt/kanda-zk-bridge/bridge.py
import time, requests, base64
from zk import ZK

KANDA = "https://<tenant>.kanda.app/api/timeclock/punch"
SLUG  = "<tenant-slug>"
DEVICE_ID = "ZK-LOBBY-01"

# 1) Map ZK user_id -> Kanda PIN (one-time provisioning, kept in a json file).
USER_TO_PIN = {1001: "1234", 1002: "2345"}

conn = ZK("192.168.0.201", port=4370).connect()
for attendance in conn.live_capture():  # blocks; yields every fingerprint match
    if attendance is None:
        continue
    pin = USER_TO_PIN.get(attendance.user_id)
    if not pin:
        continue
    payload = {"pin": pin, "device_id": DEVICE_ID, "selfie_b64": None}
    # Tell Kanda this came from a biometric device, not a PIN keypad.
    # (do this by patching source server-side via a small backend shim
    #  OR by adding ?source=biometric to the URL — pick one strategy.)
    requests.post(KANDA, json=payload, headers={"X-Tenant-Slug": SLUG}, timeout=5)
```

**To deploy**: drop the bridge on any Linux box that can see the device's
LAN (a Raspberry Pi works). `pip install pyzk requests`. Run via systemd.

## Browser WebAuthn (laptop / tablet fingerprint readers)

For devices where the staff terminal itself has a fingerprint sensor
(MacBook, modern Windows tablets), the frontend can replace the PIN
keypad with a WebAuthn flow. The server stays exactly the same: the
employee's `pin` is still sent on the punch request — it's just unlocked
by the fingerprint instead of being typed. WebAuthn credentials per
employee are stored as a `webauthn_credentials` array on the user doc.

## QR rotation (mobile-only setups)

For small teams without a dedicated terminal: print a daily-rotating QR
code on the noticeboard that encodes a short-lived token. The employee
scans it on their phone, taps a button, types their PIN. Same endpoint.

## Source field

`POST /api/timeclock/punch` always writes `source: "pin"` today. To
record a different source per device, either:

1. Extend `TimePunchRequest` to accept `source`, or
2. Add a thin per-device endpoint that calls the same handler and
   overrides the source.

Both approaches stay backwards-compatible.
