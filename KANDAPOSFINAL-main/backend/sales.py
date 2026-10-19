"""One definition of "sales" for every report, rollup and digest.

Master Test Report P0-3: Overview, Reports, the trend, Payment Methods, Peak
Hours and the Daily Digest each computed sales their own way, so voided and
unpaid orders were counted as sales and refunds were counted twice. The rule
now, everywhere:

  * voided orders never count;
  * an order only counts as a sale once it is paid (payment != "unpaid") —
    unpaid orders are reported separately as "open";
  * a sale's value is what was paid minus what was refunded.
"""
from __future__ import annotations

# Mongo filter fragments, safe to spread into any $match / find().
NOT_VOIDED = {"voided": {"$ne": True}}
PAID = {"payment": {"$nin": ["unpaid", None]}}
PAID_NOT_VOIDED = {**NOT_VOIDED, **PAID}

# Same thing as an aggregation expression: ₹ a paid order actually brought in.
NET_EXPR = {"$max": [0, {"$subtract": ["$total", {"$ifNull": ["$refunded_amount", 0]}]}]}


def is_voided(o: dict) -> bool:
    return bool(o.get("voided"))


def is_paid(o: dict) -> bool:
    return (o.get("payment") or "unpaid") != "unpaid"


def net_sales(o: dict) -> float:
    """₹ this order contributes to sales: 0 if voided or unpaid, else
    total minus refunds (never negative)."""
    if is_voided(o) or not is_paid(o):
        return 0.0
    return max(0.0, float(o.get("total") or 0) - float(o.get("refunded_amount") or 0))
