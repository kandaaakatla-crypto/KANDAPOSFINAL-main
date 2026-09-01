"""CLI to reset an existing Platform Owner's password.

owner_bootstrap.py's create_owner() is idempotent on email — re-running it
against an email that already exists just returns the existing row and does
NOT update the password. This is the companion script for the case that's
actually needed for: you forgot the password.

Usage:
    python -m owner_reset_password                        # interactive
    python -m owner_reset_password --email you@example.com
"""
import argparse
import asyncio
import getpass
import sys

from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / ".env")

from db import get_db
from owners import hash_password


async def _main(email: str, password: str) -> None:
    db = get_db()
    email = email.lower().strip()
    existing = await db.platform_owners.find_one({"email": email})
    if not existing:
        print(f"No Platform Owner found with email {email!r} — nothing to reset.", file=sys.stderr)
        sys.exit(1)

    await db.platform_owners.update_one(
        {"email": email},
        {"$set": {"password_hash": hash_password(password)}},
    )
    print()
    print("=" * 60)
    print(f"  Password reset for {email}")
    print("  TOTP is unchanged — use the same authenticator entry as before.")
    print("=" * 60)


def cli() -> None:
    p = argparse.ArgumentParser(description="Reset a Kanda POS Platform Owner's password")
    p.add_argument("--email", help="Owner email (lowercased)")
    p.add_argument("--password", help="New password")
    args = p.parse_args()

    email = args.email or input("Email: ").strip().lower()
    password = args.password or getpass.getpass("New password: ")
    if not email or not password:
        print("Email and password are required", file=sys.stderr)
        sys.exit(1)
    asyncio.run(_main(email=email, password=password))


if __name__ == "__main__":
    cli()
