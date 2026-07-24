"""Shared IST (India Standard Time, UTC+5:30) clock for the whole backend.

Kanda POS is single-country (India) — every stored timestamp, cron boundary,
and scheduled send-time is anchored to IST rather than UTC so that "midnight"
and "9am" in the data actually line up with the restaurant's wall clock.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def now_ist() -> datetime:
    return datetime.now(IST)
