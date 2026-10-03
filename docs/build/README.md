# Kanda POS — build & release documentation

Kanda POS ships as one React codebase (`KANDAPOSFINAL-main/frontend`) built four
different ways, plus one FastAPI backend (`KANDAPOSFINAL-main/backend`) deployed
to Cloud Run:

| Build | What it is | `REACT_APP_APP_TARGET` | Ships via |
|---|---|---|---|
| Web | Marketing site + `/biz` dashboard + `/owner` portal + storefront | *(unset)* | Firebase Hosting, auto-deploy on push to `master` |
| Windows — Kanda POS | Cashier/driver/clock-in desktop app (Electron) | `pos` | Tag or manual GitHub Actions run |
| Windows — Kanda Display | Kitchen Display / Packing / Customer Display desktop app (Electron) | `display` | Tag or manual GitHub Actions run |
| Android — Kanda POS | Same as the Windows POS app, packaged with Capacitor | `pos` | Tag or manual GitHub Actions run |
| Android — Kanda Display | Same as the Windows Display app, packaged with Capacitor | `display` | Tag or manual GitHub Actions run |
| Android — Kanda Driver | Delivery-driver phone app (claim, navigate, collect cash, mark delivered), packaged with Capacitor | `driver` | Tag or manual GitHub Actions run |

Backend deploys to two Cloud Run regions (asia-south1 for the HTTP API,
us-central1 for WebSocket) on every push to `master` that touches
`KANDAPOSFINAL-main/backend/**`.

This folder has one doc per audience — read the one that matches what you're
about to do, not all of them:

- **[developer-setup.md](developer-setup.md)** — cloning the repo and running
  the app locally. Start here if you're writing code.
- **[release-and-builds.md](release-and-builds.md)** — what each of the 6
  CI/CD workflows does, how to trigger a release build, and a real quirk this
  repo has around tag-triggered workflows. Start here if you're cutting a
  release or need a build artifact.
- **[secrets-and-infrastructure.md](secrets-and-infrastructure.md)** — every
  credential the build needs, where it lives (GitHub Secrets vs. GitHub
  Variables vs. GCP Secret Manager), and what's configured today vs. still
  missing. Start here if you're rotating a key or setting up a new
  integration.
- **[app-publishing.md](app-publishing.md)** — what happens after a signed
  build exists: Play Console upload, Windows installer distribution, and the
  desktop auto-update feeds. Start here if you're actually shipping a build
  to end users.

None of these docs contain secret values. Where a doc needs to reference a
credential, it names where that credential lives, not what it is.
