"""Safe cleanup of QA detritus.
from tz import now_ist

⚠️  RULES (added 2026-02-20 after a misfire that nuked a real customer):
1. **Dry-run by default.** Re-run with `--apply` to actually delete.
2. Customer deletes are ONLY ever by name match against very-strict QA
   patterns. We never, ever delete by id-shape or random heuristics.
3. Orders use the same strict customer-name guard. If you want to expire old
   orders, mark them `status='completed'` instead.
4. Every targeted record is enumerated first and printed so you can sanity
   check before passing `--apply`.

Usage:
    python -m cleanup_qa            # dry run, prints what *would* be removed
    python -m cleanup_qa --apply    # actually deletes
"""
import asyncio
import re
import sys
import logging
from dotenv import load_dotenv
from pathlib import Path

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

from db import get_db, close as close_db

# Only these *very specific* patterns are considered QA-generated. If you make
# this looser you risk losing real user data — see git blame on this file.
QA_TENANT_SLUG_PREFIX = re.compile(r"^qatest", re.I)
QA_TICKET_SUBJECT_RE = re.compile(r"^(smoke|test_|qa[:_ ]|owner-flow|smoke chain)", re.I)
QA_CUSTOMER_NAME_RE = re.compile(r"^TEST_")
QA_ORDER_CUSTOMER_RE = re.compile(r"^(TEST_|QA |Iter\d|UI Probe|Iter5 Smoke|Smoke Chain)", re.I)

SCOPED_COLLECTIONS = (
    "users", "categories", "menu_items", "customers", "tables", "inventory",
    "orders", "audit_logs", "error_logs", "support_tickets", "subscription_events",
    "owner_impersonations",
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("kanda.cleanup")


async def cleanup_qa_tenants(db, apply: bool) -> int:
    qa_tenants = await db.tenants.find(
        {"slug": {"$regex": QA_TENANT_SLUG_PREFIX}},
        {"_id": 0, "id": 1, "slug": 1, "name": 1},
    ).to_list(500)
    if not qa_tenants:
        return 0
    log.info("[%s] would remove tenants: %s",
             "APPLY" if apply else "DRY",
             [(t["slug"], t["id"]) for t in qa_tenants])
    if not apply:
        return len(qa_tenants)
    for t in qa_tenants:
        tid = t["id"]
        for coll in SCOPED_COLLECTIONS:
            await db[coll].delete_many({"tenant_id": tid})
        await db.tenants.delete_one({"id": tid})
    return len(qa_tenants)


async def cleanup_qa_tickets(db, apply: bool) -> int:
    q = {"subject": {"$regex": QA_TICKET_SUBJECT_RE}}
    rows = await db.support_tickets.find(q, {"_id": 0, "id": 1, "subject": 1}).to_list(500)
    if not rows:
        return 0
    log.info("[%s] would remove %s qa support tickets — first 5: %s",
             "APPLY" if apply else "DRY", len(rows), [r["subject"] for r in rows[:5]])
    if not apply:
        return len(rows)
    res = await db.support_tickets.delete_many(q)
    return res.deleted_count


async def cleanup_qa_customers(db, apply: bool) -> int:
    """Only deletes customers whose **name** begins with `TEST_`. We never
    fall back to id-shape heuristics here — see 2026-02-20 incident postmortem."""
    q = {"name": {"$regex": QA_CUSTOMER_NAME_RE}}
    rows = await db.customers.find(q, {"_id": 0, "id": 1, "name": 1, "phone": 1}).to_list(500)
    if not rows:
        return 0
    log.info("[%s] would remove %s TEST_ customers — names: %s",
             "APPLY" if apply else "DRY", len(rows), [r["name"] for r in rows[:10]])
    if not apply:
        return len(rows)
    res = await db.customers.delete_many(q)
    return res.deleted_count


async def cleanup_qa_orders(db, apply: bool) -> int:
    """Removes probe orders that match a QA customer name pattern."""
    q = {"customer.name": {"$regex": QA_ORDER_CUSTOMER_RE}}
    rows = await db.orders.find(q, {"_id": 0, "id": 1, "number": 1, "customer.name": 1}).to_list(500)
    if not rows:
        return 0
    log.info("[%s] would remove %s QA-probe orders — sample: %s",
             "APPLY" if apply else "DRY", len(rows),
             [(r["number"], r.get("customer", {}).get("name")) for r in rows[:5]])
    if not apply:
        return len(rows)
    res = await db.orders.delete_many(q)
    return res.deleted_count


async def cleanup_qa_audit_noise(db, apply: bool) -> int:
    """Trim audit/error log rows older than 90 days (was 30; widened so we don't
    lose forensic context if we need to investigate a real bug)."""
    from datetime import datetime, timezone, timedelta
    cutoff = (now_ist() - timedelta(days=90)).isoformat()
    a_count = await db.audit_logs.count_documents({"at": {"$lt": cutoff}})
    e_count = await db.error_logs.count_documents({"at": {"$lt": cutoff}})
    log.info("[%s] would prune audit_logs:%s error_logs:%s older than 90d",
             "APPLY" if apply else "DRY", a_count, e_count)
    if not apply:
        return a_count + e_count
    a = await db.audit_logs.delete_many({"at": {"$lt": cutoff}})
    e = await db.error_logs.delete_many({"at": {"$lt": cutoff}})
    return a.deleted_count + e.deleted_count


async def main(apply: bool):
    db = get_db()
    mode = "APPLY (real delete)" if apply else "DRY RUN (no writes)"
    log.info("=== cleanup_qa.py started — mode: %s ===", mode)
    t = await cleanup_qa_tenants(db, apply)
    tk = await cleanup_qa_tickets(db, apply)
    c = await cleanup_qa_customers(db, apply)
    o = await cleanup_qa_orders(db, apply)
    p = await cleanup_qa_audit_noise(db, apply)
    log.info("=== DONE  tenants=%s tickets=%s customers=%s qa_orders=%s pruned_old=%s ===",
             t, tk, c, o, p)
    if not apply and (t + tk + c + o + p):
        log.info(">> This was a DRY RUN. Re-run with `python -m cleanup_qa --apply` to commit.")
    await close_db()


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    asyncio.run(main(apply))
