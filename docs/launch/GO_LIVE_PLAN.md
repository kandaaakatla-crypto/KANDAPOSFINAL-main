# Kanda POS: go-live plan

Written 2026-11-14 from the state of `master` at `83288ff`. Every claim about
the code below was checked against the repo or the live GitHub settings on
that date. Prices come from web research and are **indicative**: most public
figures are from third-party pages, so confirm each one on the vendor's own
pricing page before signing anything.

Contents: 1) verdict, 2) what blocks launch, 3) test plan with model tiers,
4) messaging provider switch, 5) voice agent, 6) aggregators (UrbanPiper
parked), 7) platforms (Web, Android, Windows, iOS), 8) timeline, 9) what only
you can do, 10) sources.

---

## 1. Verdict

**Not ready to launch to paying restaurants yet. Realistic target: 5 to 6
weeks**, driven mostly by things with waiting periods (DLT registration,
WhatsApp sender approval, Apple and Play review, a Windows signing
certificate) rather than by code.

The core POS (orders, GST, payments at the counter, KDS, tables, reports,
dashboard) is built and deployed. What is missing is proof that it works end
to end, a production setup for payments and messaging, and three of the four
platforms.

---

## 2. What blocks launch

### Blockers (must be closed before the first paying store)

| # | Blocker | Evidence | Fix |
|---|---|---|---|
| B1 | **Online payments are not configured in production.** | `deploy-backend.yml` has no `RAZORPAY_*` entry, and every deploy replaces the service's whole environment, so keys typed into Cloud Run are wiped on the next merge. | Create the Razorpay secrets in Secret Manager, reconcile draft PR #124 with what is live (it names the Resend secret `kanda-resend-api-key`; production uses `kanda-resend-key`), merge, then make a real ₹1 payment and refund. |
| B2 | **All SMS, WhatsApp and voice run from a US Twilio number** (`+1 908…`). | GitHub variables `TWILIO_FROM_NUMBER`, `TWILIO_WHATSAPP_FROM`. | Section 4 and 5. An Indian restaurant's customers cannot sensibly call a US number, and SMS to India from it costs roughly 30x an Indian route. |
| B3 | **Scheduled jobs run on every server instance in both regions.** | FINDINGS P0-3, not started; no lock in `background_tasks.py`. | A Redis leader lock. Without it, digests and reminders can send several times. |
| B4 | **Deploys are not gated on tests.** | `deploy-backend.yml` has no dependency on the test workflow (P0-4). Frontend jest (72 tests) is not run by CI at all. | Gate both deploys on tests; add the jest run to CI. |
| B5 | **Server errors are not reliably recorded.** | P0-2 (5xx dropped from `error_logs`) not started. `sentry_sdk.init` exists, but P0-1 is unverified with a real event. | Finish PR 3 and PR 4 of `docs/p0-remediation/PLAN.md`; trigger a test exception and see it in Sentry. |
| B6 | **Money and stock paths are not safe under retries or two tills.** | FINDINGS P1-1 (1 of 131 mutating endpoints idempotent; order create is the one), P1-3 and P1-4 (stock updates not atomic). | Make refund, void, payment-verify and stock adjust idempotent or atomic. Gift cards were already fixed (#132). |
| B7 | **Nothing has been tested end to end.** | No browser tests exist. 13 backend route modules have no unit test (list in 3.2). | Section 3. |
| B8 | **Backups are unverified.** | Nothing in the repo or docs shows an Atlas backup policy or a restore drill. | Confirm continuous backup is on in Atlas, restore to a scratch cluster once, write the steps down. |
| B9 | **Never run on real hardware.** | Printing, cash drawer kick, USB/Bluetooth printers, Android on a tablet, Windows installer: all untested on devices. | Section 3.5. |
| B10 | **The voice model in use is being retired.** | Code defaults to `gpt-realtime`. One model listing reports it deprecated since 20 Jul 2026 with shutdown on 20 Jan 2027 (single source; confirm in the OpenAI dashboard). | Section 5. |

### Should fix before launch (not hard blockers)

- `CORS_ORIGINS` is `*`. Restrict to kandapos.com, `https://localhost`
  (Android), `capacitor://localhost` (iOS) and the Electron origin.
- No React error boundary (P3-1): one render error blanks the whole till.
- `GET /orders` is unbounded (P1-5); will slow down with months of data.
- `error_logs` and `audit_logs` grow forever (P3-4); add a TTL index.
- `routes/voice.py` (1,465 lines) and `routes/whatsapp.py` (636 lines) were
  never audited. They handle money (voice orders) and customer data.
- Android `versionCode` is still 1 and the web package is `0.1.0`; set a
  release version scheme before the first store upload.
- 19 open PRs from other sessions (dashboard phone app, driver app, new
  dashboard reports). Decide per PR: merge before launch, or park. Do not
  launch with them half-merged.
- Legal: privacy and terms pages exist. Still needed: a refund and
  cancellation policy page (Razorpay asks for it), a DPDP data-request
  contact, and a CA's sign-off on the GST invoice and the cash round-off line.

---

## 3. Test plan

### 3.1 How the work is split across models

The point of the split is cost: most testing work is mechanical and does not
need the strongest model. Only judgement-heavy review does.

| Tier | Model | Use it for | Do not use it for |
|---|---|---|---|
| Bulk | **Haiku 5.5** | Writing unit tests for CRUD modules from an existing test as a template; running suites and summarising failures; screenshot sweeps at set widths; accessibility scans; link and copy checks; turning a failing log into a ticket. | Anything about money, auth or concurrency. |
| Build | **Sonnet 5.5** | Playwright end-to-end flows; integration tests for payment, refund, split and offline sync; the messaging provider adapter and its tests; load-test scripts; CI wiring. | Final sign-off on security or tax correctness. |
| Review | **Opus 5.5** (or Fable) | Auditing `voice.py` and `whatsapp.py`; tenant-isolation and auth review; idempotency and atomicity design; GST and refund maths review; reviewing every test the lower tiers wrote for "does this test actually prove anything"; the go/no-go review. | Bulk test writing. |
| Human | You, a cashier, a CA | Real hardware, a real payment, store submissions, KYC, tasting the voice agent in Telugu and Hindi. | — |

Rule carried over from `CLAUDE.md`: a test must be seen to fail before the
fix (or, for new coverage, must fail when the behaviour is deliberately
broken). The review tier spot-checks this, because a cheap model will
happily write tests that cannot fail.

### 3.2 Backend unit coverage (Haiku writes, Opus samples 1 in 5)

No unit test touches these 13 route modules: `central_supply`, `gift_cards`,
`inventory`, `menu_csv`, `menu_schedules`, `onboarding`, `pos_devices`,
`prep`, `reservations`, `shifts`, `suppliers`, `tips`, `waste`.

Thinly covered (one test file each): `brands`, `cashdrawer`, `locations`,
`plans`, `store_credit`, `surge`, `tables`, `timeclock`, `website_orders`.

For each module: happy path, validation rejects, role and permission
rejects, and **a second tenant cannot read or change the first tenant's
rows**. The tenant check is the one that matters most and must be in every
file. Priority order: `gift_cards` and `inventory` (money and stock), then
`reservations`, `tips`, `shifts`, then the rest.

Also retire or convert the 21 legacy files in `backend/tests/` that need a
live server; they cannot run in CI and give false comfort.

### 3.3 End-to-end browser tests (Sonnet builds, runs in CI against a seeded stack)

`docker-compose.yml` already brings up Mongo and the backend. Add Playwright
and cover these flows, each on desktop width and at 768px:

1. PIN login, wrong PIN, lockout after 6 failures, deactivated staff.
2. Dine-in order: table, items with sizes and toppings, send to kitchen,
   KDS shows it, add a second round, settle by cash with round-off on and
   off, receipt totals match the server.
3. Takeaway paid by card-machine, UPI, split cash plus UPI.
4. Discount, coupon, loyalty redeem, gift card, store credit, tip: each
   alone and two combined; GST is on the discounted value.
5. Refund (partial, full, to store credit) and void; order badge and
   reports change accordingly.
6. Offline: go offline, place three orders, come back, all three sync once,
   numbers replace placeholders, nothing duplicates.
7. Retail sale with a barcode scan.
8. QR table ordering, with and without the phone OTP.
9. Dashboard: owner, area manager, store manager each see only what they
   should; a manager without Payroll sees no salaries.
10. Owner password reset by email link (mail captured in the test).
11. Cash drawer: open, sales, close, expected cash equals float plus cash
    sales.
12. Two tills on one store at once: same table, same gift card, last stock
    unit.

### 3.4 Money, security and reliability review (Opus)

- Full read of `voice.py` and `whatsapp.py`: webhook signature checks,
  tenant resolution from the dialled number, what a caller can make the
  agent do, prompt-injection through menu or customer text, cost runaway.
- Tenant isolation across all routes (grep every query for the tenant
  filter; the unit tests in 3.2 back this up).
- Idempotency and atomicity fixes for B6, with tests that fire the same
  request twice and two requests at once.
- GST: line rounding, inclusive retail pricing, service charge, discount,
  round-off, refund of a discounted order, CGST and SGST split; compare
  screen receipt, thermal receipt and PDF invoice for the same order.
- Rate limits on login, OTP, password reset and public QR endpoints.

### 3.5 Hardware and devices (human, with a checklist Haiku prepares)

On a real Windows till: network printer found by the scan; USB printer
through its Windows queue; Bluetooth printer through its COM port; test
page; a real receipt; cash drawer opens on a cash sale and not on a card
sale; barcode scanner detected; unplug and replug each device; printer
switched off mid-sale does not block the sale. On an Android tablet:
install the signed build, full shift, rotate, background and resume,
offline. On an iPad in Safari: the 768px layout and the cart.

### 3.6 Load and failure (Sonnet scripts, Opus reads the results)

- 30 tills placing an order every 20 seconds for 30 minutes against a
  staging copy; watch p95 latency, Mongo CPU, WebSocket drops.
- Kill one Cloud Run instance mid-run; no order lost, KDS reconnects.
- Redis down: the app must degrade, not fail.
- One week of shadow use in a friendly restaurant alongside their current
  till, before anyone depends on it.

### 3.7 Rough size

About 13 + 9 unit-test tasks for Haiku, 12 end-to-end flows plus load
scripts for Sonnet, and five review tasks for Opus. In calendar terms this
is about two weeks, running in parallel with the provider work.

---

## 4. Replacing Twilio for SMS, OTP and WhatsApp

### What Twilio does in the code today

| Use | Where | Twilio API |
|---|---|---|
| Customer SMS, broadcasts, digest SMS | `sms_service.py`, `routes/sms.py`, `routes/digest.py` | `messages.create` |
| QR-order phone OTP | `routes/storefront.py` | SMS or a WhatsApp template |
| WhatsApp bills, review requests, OTP | `routes/whatsapp.py` | `messages.create` with content SIDs |
| AI phone agent | `routes/voice.py` | Voice, `<Stream>`, number purchase |

### Cost comparison (India, indicative)

| | Twilio (today) | Indian route |
|---|---|---|
| SMS / OTP | about $0.083 per segment to India (about ₹7), one recent third-party reading; other pages disagree | **MSG91: ₹0.16 to ₹0.25** per SMS plus GST, lower at volume |
| WhatsApp utility message (a bill) | Meta ₹0.115 **plus Twilio's $0.005 (about ₹0.42)** per message | Meta ₹0.115, with no per-message markup on MSG91 or on Meta's Cloud API directly |
| WhatsApp OTP | From a business account registered outside India, Meta's "authentication-international" rate is reported at about ₹2.50 | ₹0.115 from an Indian business account |
| WhatsApp marketing | ₹0.8631 plus ₹0.42 | ₹0.8631 |

So a bill on WhatsApp costs roughly 4 to 5 times more through Twilio than
through an Indian account, and an SMS roughly 30 times more.

### Recommendation

**MSG91 for SMS, OTP and WhatsApp.** One Indian vendor, rupee billing with a
GST invoice, a dedicated OTP product, DLT handled in their console, and
WhatsApp at Meta's rates (a monthly fee per number of about ₹500 is
reported; confirm).

Alternatives, in order:
1. **Meta WhatsApp Cloud API directly** for WhatsApp only. Cheapest possible
   (no vendor fee at all) and a small amount of code. Worth it once volume
   is real; MSG91 first for speed.
2. **Gupshup** or **Kaleyra**: similar SMS rates (about ₹0.17 to ₹0.18),
   more enterprise-oriented onboarding.
3. **2Factor / Fast2SMS**: cheapest OTP-only routes; fine as a backup OTP
   route, not as the main vendor.

### Migration plan

1. **Start the paperwork now (it has waiting time):** DLT registration of
   Kanda Solutions Pvt Ltd as a principal entity, a sender header (for
   example `KANDAP`), and every SMS template (OTP, order ready, out for
   delivery, bill, digest). Typically 3 to 7 working days. In parallel,
   register an Indian number on a WhatsApp Business Account under the
   Indian company and resubmit the three templates (bill, review, OTP).
2. **Code (Sonnet, about 3 to 4 days):** introduce a small
   `messaging/` interface (`send_sms`, `send_otp`, `send_whatsapp_template`)
   with a Twilio adapter (current behaviour) and an MSG91 adapter, selected
   by `MESSAGING_PROVIDER`. Callers stop importing Twilio directly. DLT
   needs the template ID sent with each SMS, so SMS bodies become named
   templates rather than free text; the broadcast screen changes from "type
   anything" to "pick an approved template", because Indian operators drop
   unregistered text.
3. **Per-store senders:** today one global number serves every tenant.
   Decide whether stores share the Kanda header (simple, recommended for
   launch) or bring their own (later).
4. **Cut over:** staging on MSG91, send each template to three handsets on
   Jio, Airtel and Vi, then flip production. Keep the Twilio adapter for
   one release as a fallback, then remove it and the `twilio` dependency
   once voice has moved too.

---

## 5. A better voice agent

### What it is today

Not Google: the agent is **Twilio Voice streaming caller audio to OpenAI's
Realtime speech-to-speech model (`gpt-realtime`)**, with tools for placing
orders, booking tables and looking things up. Two problems: the phone number
is American, and the model is an older one that is reportedly being retired
(B10).

### Two separate choices

**A. Telephony (who owns the Indian phone number).** Twilio does not appear
to sell ordinary Indian local numbers, so this must change regardless.

| Option | Number rent | Per minute | Notes |
|---|---|---|---|
| **Plivo** (recommended) | about ₹250/month | ₹0.38 on Plivo's own page; ₹0.60 on third-party guides | Self-serve, audio streaming included, Indian KYC required, closest to the current Twilio design so the least rewrite. |
| Exotel | quote | reported ₹0.30 to 0.50 in, ₹0.80 to 1.00 out | Largest Indian player; AgentStream is priced separately and is not self-serve. |
| Vobiz | from about ₹600/month | ₹0.38 to 0.45 | Newer, built for voice agents. |

**B. The voice brain.**

| Option | Hindi / Telugu | Cost | Effort |
|---|---|---|---|
| **1. Newer OpenAI Realtime model** | Hindi voices reportedly added Oct 2026; no evidence of Telugu voices | Highest; per audio token, hard to predict | Smallest: change the model, voice and session settings |
| **2. Sarvam pipeline**: Saaras speech-to-text, an LLM for the logic and tools, Bulbul v3 text-to-speech | Built for Indian languages and code-switching (Hinglish, Tenglish); the only option with clear Telugu support | STT about ₹0.50/minute; TTS about ₹3 per 1,000 characters; plus a small LLM cost. Likely the cheapest per call | Larger: three streaming hops, barge-in and turn-taking to build and tune |
| 3. Gemini Live | Multilingual; Telugu quality unverified | Lowest published audio rates | Medium; no direct phone path |
| 4. ElevenLabs agents | Best English voices; Indian-language depth contested, Telugu doubtful | about $0.08/minute plus LLM | Medium |

### Recommendation

Your customers will call in Telugu, Hindi and Indian English, so judge on
that, not on English demos.

1. Move telephony to **Plivo** first (needed anyway).
2. Build the agent behind a provider switch and run a **one-week blind
   bake-off** of option 1 against option 2: the same 30 scripted calls
   (order, change an order, book a table, ask if something is sold out,
   noisy kitchen background, mid-sentence language switch) in Telugu, Hindi
   and English, scored by two native speakers for understanding, voice
   naturalness, response delay and order accuracy.
3. Expected outcome, to be proven by the test: **Sarvam for Telugu and
   Hindi callers**, the OpenAI model kept as the English and fallback
   option. If Sarvam's delay is noticeably worse, keep OpenAI for
   everything and revisit.

The agent's tools and prompts stay as they are in both cases; only the
audio path changes. Whatever wins, the voice agent should launch **after**
the POS, as an add-on a store switches on, not as part of day one.

---

## 6. Aggregators: launch without UrbanPiper, keep the door open

- **Launch behaviour:** staff key Swiggy and Zomato orders in by hand and
  tag the source. This already works, including surge pricing by channel
  and channel reporting.
- **UrbanPiper stays parked** as draft PR #48. Do not merge it. It was never
  tested against a live UrbanPiper order.
- **The route to plug it in later** already exists in that PR's design: a
  per-store keyed webhook (`POST /api/integrations/urbanpiper/orders`)
  modelled on Website Orders, mapping items by merchant ID, idempotent on
  the aggregator's order ID. Before launch, do one small thing so it stays
  cheap to add: keep `source` values `swiggy` / `zomato` / `other` and the
  `aggregatorTotal` idea stable, and note in `FINDINGS.md` that aggregator
  GST under section 9(5) is still counted as the restaurant's.
- When you sign with UrbanPiper: rebase #48, test in their sandbox, add
  status push-back and cancellations, then release as an add-on.

---

## 7. Platforms

| Platform | State today | What is left |
|---|---|---|
| **Web** (kandapos.com) | Live, auto-deploys from `master`. | Gate deploys on tests; restrict CORS. |
| **Android** (POS and Display) | Signed builds work from a tag. Never installed on a device in this effort. | Bump version; Play Console listing, screenshots, data-safety form, privacy URL; internal test track, then production. A new *personal* developer account needs 12 testers for 14 days before production; an *organisation* account does not, so register as the company. Allow about a week for first review. |
| **Windows** (POS and Display) | Builds, but **unsigned**, and the auto-update feed only publishes for signed builds. | Buy a code-signing certificate (OV is enough; EV removes the SmartScreen warning from day one), set `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD`, cut a tag, test install and one auto-update. Allow 1 to 2 weeks for certificate vetting. |
| **iOS** | **There is no iOS POS app.** The only iOS work is the Dashboard phone app in open PR #41: unsigned, never compiled on a Mac, never run. | Apple Developer Program as an organisation (needs a D-U-N-S number; allow 1 to 2 weeks), signing certificates in CI, TestFlight, App Review. |

**Recommended iOS scope for launch:** ship the **Dashboard app** on iPhone
(owners want this on their phone) and run the **POS on iPad as a web app**
in Safari with "Add to Home Screen". A native iPad POS is a second phase,
because receipt-printer and cash-drawer access on iOS needs printer-vendor
SDKs and cannot reuse the Windows approach. If a native iPad till is a
day-one requirement, add about 3 to 4 weeks.

Also decide now: the Driver app (draft PR #37) and the Android Dashboard app
(PR #41) are launch items or not. Recommendation: Dashboard app yes, Driver
app after launch.

---

## 8. Timeline (5 to 6 weeks)

| Week | Code and testing | Paperwork you start |
|---|---|---|
| 1 | B1 payments wiring; B3 job lock; B4 test gate and jest in CI; B5 error capture; Playwright scaffold. | DLT entity and header; WhatsApp Business Account on an Indian number; Plivo KYC; Apple and Google organisation accounts; Windows certificate order; confirm Atlas backups. |
| 2 | B6 idempotency and atomicity; unit tests for the 13 modules; first 6 end-to-end flows; messaging adapter. | DLT templates; WhatsApp templates; Razorpay live KYC if not done. |
| 3 | Remaining end-to-end flows; `voice.py` / `whatsapp.py` audit; MSG91 cut-over on staging; error boundary, CORS, TTL indexes. | Refund policy page; CA review of invoice and round-off. |
| 4 | Hardware day; load test; Android internal track; signed Windows build; Plivo telephony move. | Play listing; store screenshots. |
| 5 | Shadow week in a friendly restaurant; fix what it finds; iOS Dashboard on TestFlight; voice bake-off. | App Review submissions. |
| 6 | Go/no-go review (Opus), then first paying store. Voice agent released after, as an add-on. | — |

---

## 9. What only you can do

1. Razorpay live keys into Secret Manager (and confirm live KYC is approved).
2. DLT registration, header and templates; MSG91 account.
3. WhatsApp Business Account under the Indian company with an Indian number.
4. Plivo account and KYC; choose the restaurant-facing phone numbers.
5. Apple Developer (organisation, D-U-N-S) and Google Play (organisation).
6. Windows code-signing certificate.
7. Confirm MongoDB Atlas backups and do one restore.
8. A CA's sign-off on the GST invoice format and the round-off line.
9. Decide the 19 open PRs: merge before launch or park.
10. Hardware: one receipt printer each of network, USB and Bluetooth; a cash
    drawer; a scanner; an Android tablet; an iPad.
11. Two native Telugu and Hindi speakers for the voice test.
12. One friendly restaurant for the shadow week.

---

## 10. Sources

Prices and vendor facts above come from these pages (accessed 2026-11-14).
Several are vendor or competitor blogs; treat figures as leads to verify.

- MSG91 SMS pricing: https://productgrowth.in/tools/engagement/msg91/ ,
  https://uniquedigitaloutreach.in/msg91-vs-udo-sms-pricing-full-cost-comparison/ ,
  https://www.messagecentral.com/en-in/blog/sms-otp-pricing-india
- Twilio SMS to India: https://textbee.dev/sms-pricing/twilio ,
  https://www.twilio.com/sms/pricing/in
- WhatsApp India rate card (from 1 Oct 2026):
  https://mindlytics.in/blog/whatsapp-business-api-pricing-india-2026 ,
  https://dev.to/xreach51/whatsapp-business-api-pricing-in-india-2026-every-layer-of-the-bill-12i7 ,
  https://whautomate.com/whatsapp-business-api-pricing-india
- Twilio WhatsApp per-message fee: https://www.twilio.com/en-us/whatsapp/pricing
- MSG91 WhatsApp: https://msg91.com/guide/lowest-whatsapp-api-pricing-globally ,
  https://www.zoko.io/post/msg91-whatsapp-api-pricing-india ,
  https://richautomate.in/blog/msg91-pricing-india-2026
- Plivo India voice: https://www.plivo.com/voice/pricing/in/ ,
  https://www.plivo.com/livekit/ ,
  https://www.plivo.com/docs/voice/concepts/india-calling.md
- Exotel: https://exotel.com/blog/migrate-twilio-to-exotel-voice-ai-india/ ,
  https://convo360.ai/blog/exotel-pricing-india-ai-voice-calls/
- Vobiz and SIP comparisons:
  https://www.vobiz.ai/resources/blogs/buyers-guide/vobiz-vs-exotel-comparison/ ,
  https://www.autointerviewai.com/blog/plivo-vs-vobiz-sip-provider-india-ai-calling-2026
- Twilio and Indian numbers: https://www.twilio.com/en-us/guidelines/in/voice ,
  https://support.vapi.ai/t/28503446/indian-phone-number-for-vapi
- Sarvam pricing: https://convo360.ai/blog/sarvam-ai-pricing-india/ ,
  https://www.usagepricing.com/blueprint/sarvam-ai
- Voice model comparisons: https://www.coval.ai/blog/voice-ai-models-2026/ ,
  https://micdrop.dev/blog/top-speech-to-speech-apis-voice-agents ,
  https://haass.io/blog/eleven-labs-vs-sarvam-ai-vs-gnani-ai ,
  https://www.eesel.ai/blog/gpt-live-alternatives
- OpenAI Realtime pricing and model status: https://openai.com/api/pricing/ ,
  https://llmgateway.io/models/gpt-realtime/openai ,
  https://www.forasoft.com/blog/article/openai-realtime-api-pricing
