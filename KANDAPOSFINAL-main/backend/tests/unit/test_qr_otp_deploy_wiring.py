"""Each deploy replaces the Cloud Run environment with the workflow's
--set-env-vars list. QR_OTP_REQUIRED defaults to on in code, so if the
workflow didn't pass it, production would demand a code that no channel can
send yet and every QR order would be blocked. The workflow passes it, off
unless the repo variable turns it on.
"""
import re
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[4] / ".github" / "workflows" / "deploy-backend.yml"


def _env_lists():
    return re.findall(r'--set-env-vars "([^"]*)"', WORKFLOW.read_text())


def test_qr_otp_settings_passed_to_both_regions():
    lists = _env_lists()
    assert len(lists) == 2
    for env in lists:
        assert "QR_OTP_REQUIRED=${{ vars.QR_OTP_REQUIRED || '0' }}" in env
        assert "WA_OTP_CONTENT_SID=" in env
        assert "SMS_OTP_ENABLED=" in env
