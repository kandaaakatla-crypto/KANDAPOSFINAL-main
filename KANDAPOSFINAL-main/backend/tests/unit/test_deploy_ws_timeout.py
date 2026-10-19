"""Cloud Run closes any request, WebSockets included, after its timeout,
which defaults to 300 seconds. AI phone calls (Twilio media stream) and POS
live updates run over WebSockets on the us-central1 service, so every phone
call was cut off at five minutes. The WebSocket deploy now sets the maximum
60-minute timeout.
"""
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[4] / ".github" / "workflows" / "deploy-backend.yml"


def _ws_step() -> str:
    text = WORKFLOW.read_text()
    start = text.index("us-central1 — WebSocket")
    return text[start:text.index("--set-secrets", start)]


def test_websocket_service_allows_hour_long_connections():
    assert "--timeout 3600" in _ws_step()
