"""Covers the daily EOD leads-digest email (background_tasks.py's
leads_digest_loop / _send_leads_digest) and its email template."""
import os

from email_service import landing_leads_digest_email
from background_tasks import _send_leads_digest


def test_digest_email_lists_every_lead():
    leads = [
        {"type": "demo", "name": "Asha Rao", "email": "asha@example.com", "phone": "+91 1", "business": "Asha's"},
        {"type": "updates", "name": None, "email": "b@example.com", "phone": None, "business": None},
    ]
    subject, html = landing_leads_digest_email(leads, "09 Sep 2026")
    assert "2 total" in subject
    assert "09 Sep 2026" in subject
    assert "asha@example.com" in html
    assert "b@example.com" in html
    assert "Asha's" in html


def test_digest_email_handles_zero_leads():
    subject, html = landing_leads_digest_email([], "09 Sep 2026")
    assert "0 total" in subject
    assert "No submissions today" in html


async def test_send_leads_digest_skips_without_support_email(db, monkeypatch):
    monkeypatch.delenv("SUPPORT_TO_EMAIL", raising=False)
    count = await _send_leads_digest(db)
    assert count == 0


async def test_send_leads_digest_counts_todays_leads(client, db, monkeypatch):
    monkeypatch.setenv("SUPPORT_TO_EMAIL", "owner@example.com")
    # RESEND_API_KEY stays unset in the unit-test env, so send_email() is a
    # documented no-op ({"skipped": True}) — this only exercises the query
    # + count logic, not real delivery.
    client.post("/api/leads", json={"type": "updates", "email": "digest-check@example.com"})

    count = await _send_leads_digest(db)
    assert count >= 1
