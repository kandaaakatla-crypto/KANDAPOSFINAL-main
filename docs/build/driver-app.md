# Kanda Driver app and customer delivery tracking

## What's where

**In the Kanda Driver app** (Android, `REACT_APP_APP_TARGET=driver`, also at
`/:slug/driver` on the web):

- On/off duty, available deliveries, claim, active runs, today's completed
  runs, earnings (cash in hand, tips, delivery fees, average delivery time).
- Live GPS sharing while on duty, via a foreground-service notification
  ("Sharing your location") so it keeps working with the screen locked.
- "New delivery" notifications: a local notification while the app is
  running, plus FCM push when it's closed (needs Firebase, below).
- Delivery OTP entry at the door, cash collection, and a "Resend link to
  customer" button.

**Customer side, outside the app:**

- When a driver marks an order out for delivery, the customer gets a
  WhatsApp message (SMS fallback) with a tracking link and a 4-digit OTP.
- The link opens `https://<PUBLIC_BASE_URL>/track/<token>`: order progress,
  the driver's live location on a map, the OTP, amount to pay, store phone.
  The link stops working 24 hours after delivery.

## The OTP rule

The driver must enter the OTP only when the message to the customer was
actually accepted by Twilio (`trackingNotified.ok` on the order). If
WhatsApp/SMS isn't configured or the send failed, the customer never had a
code, so the driver can complete without one. After 5 wrong OTPs the driver
is locked out of that order; a manager can still complete it from the POS.

The OTP and tracking token never reach staff or drivers: they're stripped
from API responses (`clean()`, `Order` response model, driver feed) and from
WebSocket broadcasts.

## Setup

| What | Where | Needed for |
|---|---|---|
| `PUBLIC_BASE_URL` | Already set in `deploy-backend.yml` | The tracking link domain |
| Twilio vars (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_FROM_NUMBER`) | Cloud Run (not yet in `deploy-backend.yml`, see secrets-and-infrastructure.md) | Sending the link + OTP |
| Tenant features `whatsapp` and/or `customer_sms` | Store settings | Which channel is used |
| `TWILIO_WA_TRACKING_CONTENT_SID` | Cloud Run env | WhatsApp outside a 24h customer session |
| `FCM_SERVICE_ACCOUNT_JSON` | Cloud Run (Secret Manager) | Push to drivers when the app is closed |
| `DRIVER_GOOGLE_SERVICES_JSON` | GitHub Actions secret | Lets the Android build register for push |

### WhatsApp template

WhatsApp only allows free-form messages within 24 hours of the customer
messaging the store. For everyone else, create a Twilio Content template and
get it approved by Meta, then set `TWILIO_WA_TRACKING_CONTENT_SID`. Variables:

| | |
|---|---|
| `{{1}}` | Customer first name |
| `{{2}}` | Order number |
| `{{3}}` | Store name |
| `{{4}}` | Tracking link |
| `{{5}}` | OTP (`-` when there's none) |

Example body: *Hi {{1}}, your order #{{2}} from {{3}} is on the way. Track it
live: {{4}} Delivery OTP: {{5}}. Share it with the driver only when you
receive your order.*

### Firebase (push when the app is closed)

1. Create a Firebase project (or use the existing one) and add an Android
   app with package `com.kandapos.driver`.
2. Download `google-services.json` and save its full contents as the GitHub
   secret `DRIVER_GOOGLE_SERVICES_JSON`. The build workflow writes it into
   `android-driver/app/` and turns on push registration
   (`REACT_APP_FCM_ENABLED`). Without it the app still works, with
   notifications only while it's open.
3. Create a service account with the *Firebase Cloud Messaging API Admin*
   role, download its JSON key, store it in Secret Manager and expose it to
   the backend as `FCM_SERVICE_ACCOUNT_JSON`. Note `deploy-backend.yml` uses
   `--set-secrets`, which replaces the service's secret list on every
   deploy, so it has to be added there to survive the next deploy.

## Driver phones and the till lock

On real (non-demo) stores each phone must be unlocked once by a manager
before a driver can sign in, same as a till. The driver build only accepts
Driver PINs.

## Android build notes

- `capacitor.config.driver.json` sets `includePlugins`, so the GPS and
  notification plugins only go into the driver app; the POS and display
  configs list their own plugins for the same reason.
- `@capacitor-community/background-geolocation` officially supports
  Capacitor 7; this app is on Capacitor 8. Validate the first build on a
  real phone (GPS with the screen off) before handing it to drivers.
- Build: push a tag `android-driver-v*` or run the workflow manually.
