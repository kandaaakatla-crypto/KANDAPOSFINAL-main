"""CLI to bootstrap the first Platform Owner.

Usage:
    python -m owner_bootstrap          # interactive (prompts for email + password)
    python -m owner_bootstrap --email owner@kanda.app --password "..." --name "You"
"""
import argparse
import asyncio
import getpass
import sys

from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / ".env")

from db import get_db
from owners import create_owner, provisioning_uri


async def _main(email: str, password: str, name: str) -> None:
    db = get_db()
    owner = await create_owner(db, email=email, password=password, name=name)
    uri = provisioning_uri(owner["totp_secret"], owner["email"])
    print()
    print("=" * 68)
    print("  Kanda POS — Platform Owner provisioned")
    print("=" * 68)
    print(f"  Email          : {owner['email']}")
    print(f"  Name           : {owner['name']}")
    print(f"  Owner ID       : {owner['id']}")
    print()
    print("  TOTP secret (enter manually in your authenticator app):")
    print(f"      {owner['totp_secret']}")
    print()
    print("  Or scan the otpauth URI below as a QR code:")
    print(f"      {uri}")
    print("=" * 68)
    print("  Keep this output safe — the TOTP secret is shown only here.")
    print("=" * 68)


def cli() -> None:
    p = argparse.ArgumentParser(description="Bootstrap a Kanda POS Platform Owner")
    p.add_argument("--email", help="Owner email (lowercased)")
    p.add_argument("--password", help="Owner password")
    p.add_argument("--name", default="Owner", help="Display name (default: Owner)")
    args = p.parse_args()

    email = args.email or input("Email: ").strip().lower()
    password = args.password or getpass.getpass("Password: ")
    if not email or not password:
        print("Email and password are required", file=sys.stderr)
        sys.exit(1)
    asyncio.run(_main(email=email, password=password, name=args.name))


if __name__ == "__main__":
    cli()
