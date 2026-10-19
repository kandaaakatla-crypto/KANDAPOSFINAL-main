"""Each deploy replaces the Cloud Run service's whole environment with the
--set-env-vars / --set-secrets lists in the workflow. Razorpay, Twilio,
Resend and the WhatsApp settings weren't in those lists, so even if someone
set them by hand in the Cloud Run console the next merge wiped them: online
payments, the AI phone agent, WhatsApp bills and emails could never stay on
in production. Both regions now get them on every deploy.
"""
import re
from pathlib import Path

import pytest

WORKFLOW = Path(__file__).resolve().parents[4] / ".github" / "workflows" / "deploy-backend.yml"

SECRETS = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET",
           "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY"]
VARS = ["PUBLIC_BACKEND_URL", "TWILIO_WHATSAPP_FROM", "TWILIO_FROM_NUMBER",
        "WA_BILL_CONTENT_SID", "WA_REVIEW_CONTENT_SID", "SUPPORT_FROM_EMAIL", "SUPPORT_TO_EMAIL"]


def _deploy_steps() -> list[str]:
    text = WORKFLOW.read_text()
    return re.findall(r"gcloud run deploy.*?(?=\n\s*\n|\Z)", text, flags=re.S)


@pytest.mark.parametrize("name", SECRETS)
def test_secret_set_on_both_regions(name):
    steps = _deploy_steps()
    assert len(steps) == 2
    for step in steps:
        secrets = step[step.index("--set-secrets"):]
        assert f"{name}=" in secrets, name


@pytest.mark.parametrize("name", VARS)
def test_setting_passed_to_both_regions(name):
    for step in _deploy_steps():
        env = step[step.index("--set-env-vars"):step.index("--set-secrets")]
        assert f"{name}=" in env, name
