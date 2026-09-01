"""CLI to re-print an existing Platform Owner's TOTP secret.

Read-only — does not touch the account, password, or generate a new secret.
For when the key wasn't copied correctly into an authenticator app the
first time and you just need to see it again.

Usage:
    python -m owner_show_totp                        # interactive
    python -m owner_show_totp --email you@example.com
"""
import argparse
import asyncio
import sys

from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / ".env")

from db import get_db
from owners import provisioning_uri


async def _main(email: str) -> None:
    db = get_db()
    email = email.lower().strip()
    owner = await db.platform_owners.find_one({"email": email})
    if not owner:
        print(f"No Platform Owner found with email {email!r}.", file=sys.stderr)
        sys.exit(1)

    print()
    print("=" * 60)
    print(f"  TOTP secret for {email}")
    print("=" * 60)
    print(f"  Key (enter manually): {owner['totp_secret']}")
    print()
    print("  Or scan the otpauth URI below as a QR code:")
    print(f"      {provisioning_uri(owner['totp_secret'], owner['email'])}")
    print("=" * 60)


def cli() -> None:
    p = argparse.ArgumentParser(description="Show a Kanda POS Platform Owner's TOTP secret")
    p.add_argument("--email", help="Owner email (lowercased)")
    args = p.parse_args()

    email = args.email or input("Email: ").strip().lower()
    if not email:
        print("Email is required", file=sys.stderr)
        sys.exit(1)
    asyncio.run(_main(email=email))


if __name__ == "__main__":
    cli()
