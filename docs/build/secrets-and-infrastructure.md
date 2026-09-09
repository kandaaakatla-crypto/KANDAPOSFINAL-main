# Secrets & infrastructure

**Audience:** whoever manages credentials, rotates keys, or sets up a new
integration. This doc names every credential the build/deploy pipeline
needs, where it's stored, and what feeds off it. **No secret values are
written here** — only names, purposes, and locations.

Three separate credential stores are in play. Mixing them up is the most
common mistake:

| Store | Where | Used by |
|---|---|---|
| **GitHub Actions Secrets** | Repo Settings → Secrets and variables → Actions → Secrets | CI/CD workflows only, at build/deploy time |
| **GitHub Actions Variables** | Same page → Variables tab | Same — for non-sensitive config (URLs, project IDs) that's fine to see in workflow logs |
| **GCP Secret Manager** | Google Cloud Console, project `kandapos` (or via `gcloud secrets`) | The **running backend** on Cloud Run, at request time — separate from anything GitHub holds |

`gh secret list` / `gh variable list` (from repo root, needs `gh auth
login`) show what's currently set without revealing values.

## GitHub Actions Variables (non-sensitive)

| Name | Value (safe to show — not sensitive) | Used by |
|---|---|---|
| `REACT_APP_BACKEND_URL` | `https://api.kandapos.com` | Android/Windows builds (all 4) — the web build deliberately does *not* use this, see below |
| `FIREBASE_PROJECT_ID` | `kandapos` | `deploy-frontend.yml`, both Windows update-feed publish steps |
| `GCP_REGION` | `asia-south1` | `deploy-backend.yml` |
| `CORS_ORIGINS` | `*` | `deploy-backend.yml` |
| `PUBLIC_BASE_URL` | `https://kandapos.com` | `deploy-backend.yml` |
| `SENTRY_DSN_BACKEND` | (Sentry project DSN — public-ish, not a true secret) | `deploy-backend.yml` |
| `SENTRY_DSN_FRONTEND` | (Sentry project DSN) | All 4 frontend build workflows + `deploy-frontend.yml` |

**Why the web build doesn't use `REACT_APP_BACKEND_URL`:** the web build
sets it to `""` deliberately and relies on relative `/api/...` paths, which
`firebase.json`'s rewrite proxies to Cloud Run server-side (same-origin from
the browser, no CORS, sidesteps a `*.run.app` default-domain routing bug).
WebSocket connections can't go through that same rewrite, so the web build
sets a separate `REACT_APP_WS_BACKEND_URL=https://api.kandapos.com` (a
literal in `deploy-frontend.yml`, not a repo variable) just for realtime.
Android/Windows builds have no "same origin" server to rewrite against, so
they use `REACT_APP_BACKEND_URL` directly for everything.

## GitHub Actions Secrets

| Name | Purpose | Used by | Status |
|---|---|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Keyless GCP auth (Workload Identity Federation) — the recommended path | `deploy-backend.yml` | One of two auth methods; see below |
| `GCP_SERVICE_ACCOUNT` | Paired with the WIF provider above | `deploy-backend.yml` | Same |
| `GCP_SA_KEY` | Alternative: a static service-account JSON key | `deploy-backend.yml` | Simpler to set up, but a long-lived credential to rotate — configured today |
| `GCP_PROJECT_ID` | GCP project the backend deploys into | `deploy-backend.yml` | ✅ set |
| `FIREBASE_SERVICE_ACCOUNT` | Deploys to Firebase Hosting (web app + both desktop update-feed sites) | `deploy-frontend.yml`, both Windows "Publish update feed" steps | ✅ set |
| `WINDOWS_CSC_LINK` | Path/URL to the Authenticode code-signing cert (`.pfx`) | `build-windows.yml`, `build-windows-display.yml` (shared identity, both apps) | ❌ **not set** — builds succeed but produce unsigned installers |
| `WINDOWS_CSC_KEY_PASSWORD` | Password for the above cert | Same two workflows | ❌ **not set** |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded release keystore (`.p12`), shared by both Android apps by this repo's design (both workflows reference the identical secret names) | `build-android.yml`, `build-android-display.yml` | ✅ **set 2026-09-09** — RSA 2048, self-signed, `CN=Kanda POS, O=Kanda POS, L=Hyderabad, ST=Telangana, C=IN`, valid through 2056. Alias `kandapos`. |
| `ANDROID_KEYSTORE_PASSWORD` | Password for the keystore above | Same two | ✅ set |
| `ANDROID_KEY_ALIAS` | Key alias inside the keystore (`kandapos`) | Same two | ✅ set |
| `ANDROID_KEY_PASSWORD` | Password for the key entry (same value as the keystore password — PKCS12 convention) | Same two | ✅ set |

**Who has the Android keystore backup:** a copy of the `.p12` file and its
password was handed to the user directly (not committed to git, not stored
in this repo) when it was generated. **If that backup is lost and the
GitHub secret is ever cleared, there is no way to recover it** — a
differently-signed APK/AAB is treated as a different app by Google Play, so
losing this permanently blocks updating the existing app listing. Whoever
holds that backup should keep it in a password manager or equivalent, not
just on one machine.

## GCP Secret Manager (backend runtime secrets)

These are **not** GitHub secrets — they live in GCP Secret Manager and are
mounted into Cloud Run via `--set-secrets` in `deploy-backend.yml`. Rotating
one means updating it in GCP directly (`gcloud secrets versions add ...`),
not touching GitHub at all.

| Secret Manager name | Maps to env var | Purpose |
|---|---|---|
| `kanda-mongo-url` | `MONGO_URL` | Production MongoDB connection string |
| `kanda-jwt-secret` | `JWT_SECRET` | Signs staff/owner JWTs |
| `kanda-redis-url` | `REDIS_URL` | Cross-instance cache + pub/sub for realtime (WebSocket fan-out across Cloud Run instances) |
| `kanda-anthropic-key` | `ANTHROPIC_API_KEY` | Claude API — AI assistant, daily digest |
| `kanda-openai-key` | `OPENAI_API_KEY` | OpenAI API — assistant fallback, voice agent (Realtime API) |

## Backend runtime configuration — the full picture

The two tables above cover what's wired into CI/CD. Several backend
integrations are **not** wired into `deploy-backend.yml` at all — they'd
need to be set directly on the Cloud Run service (via `gcloud run services
update` or the console) outside this repo's automation, or added to the
workflow if that's ever wanted:

| Variable(s) | Feature | Currently in `deploy-backend.yml`? |
|---|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_WHATSAPP_FROM`, `TWILIO_WHATSAPP_JOIN_PHRASE`, `TWILIO_SIGNATURE_VALIDATION` | SMS, WhatsApp, voice agent | ❌ No |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Payments, subscription billing | ❌ No |
| `RESEND_API_KEY`, `SUPPORT_FROM_EMAIL`, `SUPPORT_TO_EMAIL` | Transactional email, support-ticket notifications | ❌ No |
| `PUBLIC_BACKEND_URL` | Twilio webhook callback URLs | ❌ No |
| `SMS_DEFAULT_COUNTRY_CODE`, `OPENAI_REALTIME_MODEL`, `CURRENCY` | Minor config, all have sensible defaults | ❌ No (fine as-is) |

If production is actually using SMS/WhatsApp/voice/payments/email today,
those variables are set on the Cloud Run service directly and just aren't
tracked in this repo's IaC — worth confirming in the GCP console rather than
assuming from this file alone. If they're *not* set, those features are
silently disabled in production (each one degrades gracefully rather than
crashing — see `developer-setup.md` for the same behavior locally).

## Rotating a secret — general process

**GitHub secret:**
```bash
gh secret set SECRET_NAME --repo kandaaakatla-crypto/KANDAPOSFINAL-main
# paste the value, or pipe it in: echo -n "value" | gh secret set SECRET_NAME
```
Takes effect on the next workflow run — no redeploy needed for the secret
itself, but you likely want to re-trigger the relevant workflow to actually
use the new value.

**GCP Secret Manager:**
```bash
gcloud secrets versions add kanda-mongo-url --data-file=- <<< "new-value"
```
Cloud Run reads the `:latest` version at each cold start — existing warm
instances keep the old value until they recycle. For an immediate rollout,
redeploy (re-run `deploy-backend.yml` or `gcloud run services update` with
a no-op change) rather than waiting for natural recycling.
