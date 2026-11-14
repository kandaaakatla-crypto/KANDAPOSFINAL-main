# Kanda POS launch to-do list

Companion to [GO_LIVE_PLAN.md](GO_LIVE_PLAN.md). Work top to bottom. Each
step is marked **YOU** (only you can do it) or **CLAUDE** (paste the prompt
into Claude Code, review the PR it opens, then say "merge").

How to use the Claude steps:
- One prompt at a time. Each produces one pull request.
- When Claude reports back, read the summary, then reply `merge` (or ask for
  changes). Claude checks CI and the live site after merging.
- The suggested model is in brackets. Switch models in the model picker
  before pasting. Cheaper models are fine where marked.
- Tick the box here when a step is done.

---

## Start here today (about 1 hour, all YOU)

These have waiting periods of days or weeks, so starting them first is what
keeps the launch at 5 to 6 weeks. You only need to *submit* them today.

- [ ] **Y1. DLT registration** (needed for any SMS in India). Register Kanda
      Solutions Pvt Ltd as a "Principal Entity" on one operator's DLT portal
      (Jio, Airtel or Vi; one is enough). Have ready: company PAN, GST
      certificate, incorporation certificate, an authorisation letter.
      Wait: 3 to 7 working days.
- [ ] **Y2. MSG91 account.** Sign up at msg91.com with the company details.
      Ask their sales chat for the current SMS, OTP and WhatsApp prices in
      writing.
- [ ] **Y3. Google Play developer account, as an organisation** (US$25,
      one-time). Organisation, not personal: personal accounts must run 12
      testers for 14 days first. Needs a D-U-N-S number.
- [ ] **Y4. D-U-N-S number** for the company (free from Dun & Bradstreet
      India; needed by both Google and Apple). Wait: up to 2 weeks.
- [ ] **Y5. Apple Developer Program, as an organisation** (US$99 a year).
      Start once the D-U-N-S number arrives.
- [ ] **Y6. Windows code-signing certificate.** Order an OV certificate
      (cheaper) or EV (no security warning from day one) from a reseller
      such as Sectigo or DigiCert. Wait: 1 to 2 weeks of company checks.
- [ ] **Y7. Plivo account** and submit Indian business KYC (for the phone
      line of the voice agent). Wait: a few days.
- [ ] **Y8. Razorpay:** confirm live-mode KYC is approved and you can see
      live API keys in the Razorpay dashboard.

---

## Week 1: make production safe

- [ ] **C1. CLAUDE [Sonnet]**
  > Read docs/launch/GO_LIVE_PLAN.md blocker B3 and docs/p0-remediation/PLAN.md PR 5. Fix the scheduled jobs so they run on only one server instance at a time, using a Redis lock. Follow the repo rules: failing test first, one PR, do not merge until I say.

- [ ] **C2. CLAUDE [Sonnet]**
  > Blocker B4 in docs/launch/GO_LIVE_PLAN.md: make both deploys wait for tests to pass, and add the frontend jest tests to CI. One PR. Show me a run where a failing test blocks a deploy.

- [ ] **C3. CLAUDE [Sonnet]**
  > Blocker B5: finish PR 3 and PR 4 of docs/p0-remediation/PLAN.md so server errors are recorded in error_logs and reach Sentry. After I merge, trigger one test error in production and show me it arriving in Sentry.

- [ ] **Y9. YOU: put the Razorpay live keys into Google Cloud.** In Secret
      Manager (project `kandapos`) create three secrets:
      `kanda-razorpay-key-id`, `kanda-razorpay-key-secret`,
      `kanda-razorpay-webhook-secret`. Same way you created the Resend one.

- [ ] **C4. CLAUDE [Sonnet]** (after Y9)
  > I have created the three Razorpay secrets in Secret Manager. Blocker B1: wire them into the backend deploy, reconciling draft PR #124 with what is live (the Resend secret is kanda-resend-key). Only include secrets that exist, so the deploy cannot break. Then tell me exactly how to make a real 1 rupee test payment and refund.

- [ ] **Y10. YOU: make a real ₹1 online payment and refund it** on the live
      site, following Claude's steps from C4.

- [ ] **Y11. YOU: check backups.** In MongoDB Atlas, open the cluster, go to
      Backup, confirm it is switched on, and do one "Restore" to a new test
      cluster. Tell Claude what you saw.

---

## Week 2: money safety and tests

- [ ] **C5. CLAUDE [Opus]**
  > Blocker B6 in docs/launch/GO_LIVE_PLAN.md: make refund, void, payment-verify and stock adjustments safe when the same request arrives twice or two tills act at once. One PR per fix, failing test first each time. Start with refunds.

- [ ] **C6. CLAUDE [Haiku]**
  > Section 3.2 of docs/launch/GO_LIVE_PLAN.md: write unit tests for the 13 untested backend modules, starting with gift_cards and inventory. Copy the style of tests/unit/test_customer_validation.py. Every file must include a test that a second store cannot read or change the first store's data. One PR per module.

- [ ] **C7. CLAUDE [Opus]** (after C6)
  > Review the unit tests written for section 3.2. For one in every five, break the code on purpose and confirm the test fails. List any test that cannot fail and fix it.

- [ ] **C8. CLAUDE [Sonnet]**
  > Section 3.3 of docs/launch/GO_LIVE_PLAN.md: set up Playwright against the docker-compose stack and build end-to-end flows 1 to 6. Run them in CI. One PR for the setup, then one per flow.

- [ ] **Y12. YOU: finish the DLT setup** once Y1 is approved: register a
      sender header (for example `KANDAP`) and submit the SMS templates.
      Ask Claude first:
  > List every SMS and WhatsApp message the app sends, as exact template text I can paste into the DLT portal and into WhatsApp template approval.

- [ ] **Y13. YOU: WhatsApp business number.** In MSG91 (or Meta Business
      Manager) create a WhatsApp Business Account under the Indian company
      with an Indian phone number, and submit the bill, review and OTP
      templates for approval.

---

## Week 3: finish tests, switch messaging

- [ ] **C9. CLAUDE [Sonnet]**
  > Build the remaining end-to-end flows 7 to 12 from section 3.3 of docs/launch/GO_LIVE_PLAN.md.

- [ ] **C10. CLAUDE [Opus]**
  > Section 3.4: audit backend/routes/voice.py and backend/routes/whatsapp.py for security, tenant mix-ups and cost runaway. Report findings first, ranked. Do not fix anything until I pick which ones.

- [ ] **C11. CLAUDE [Sonnet]** (after Y2, Y12, Y13)
  > Section 4 of docs/launch/GO_LIVE_PLAN.md: add a messaging layer with a Twilio adapter and an MSG91 adapter, chosen by a setting, and move SMS, OTP and WhatsApp onto it. I will give you the MSG91 template IDs. Keep Twilio as the default until I say switch.

- [ ] **Y14. YOU: put the MSG91 auth key into Secret Manager** as
      `kanda-msg91-auth-key`, then tell Claude to switch staging, test on
      three phones (Jio, Airtel, Vi), then switch production.

- [ ] **C12. CLAUDE [Sonnet]**
  > The "should fix" list in section 2 of docs/launch/GO_LIVE_PLAN.md: restrict CORS, add a React error boundary, add expiry to error_logs and audit_logs, and page GET /orders. One PR each.

- [ ] **C13. CLAUDE [Sonnet]**
  > Add a refund and cancellation policy page to the site, linked from the footer next to privacy and terms. Draft the text for a restaurant POS subscription sold by Kanda Solutions Pvt Ltd and mark what I must confirm.

- [ ] **Y15. YOU: send your CA** one sample tax invoice PDF and one receipt
      with the "Round off" line, and get written confirmation they are fine.

- [ ] **Y16. YOU: decide the open pull requests.** Ask Claude:
  > List the open pull requests with a one-line summary each and your recommendation: merge before launch, or park.

---

## Week 4: devices and app stores

- [ ] **Y17. YOU: gather hardware.** One receipt printer each of network,
      USB and Bluetooth; a cash drawer; a barcode scanner; an Android
      tablet; an iPad; a Windows PC.

- [ ] **C14. CLAUDE [Haiku]**
  > Section 3.5 of docs/launch/GO_LIVE_PLAN.md: write me a printable hardware test checklist with a tick box and a "what I saw" line for each step.

- [ ] **Y18. YOU: hardware day.** Run the checklist. Send Claude anything
      that failed, with a photo if you can.

- [ ] **C15. CLAUDE [Sonnet]**
  > Set a release version scheme (Android versionCode and versionName, package version), then cut a release tag for the Android POS app and tell me where to download the signed .aab.

- [ ] **Y19. YOU: Google Play.** Create the app listing, upload the `.aab`
      to the Internal testing track, install it on the tablet from Play.
      Ask Claude for the listing text and the data-safety answers:
  > Write the Google Play store listing for Kanda POS (short and full description) and tell me how to answer the data-safety form based on what the app actually collects.

- [ ] **Y20. YOU: add the Windows certificate** to GitHub secrets as
      `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` once Y6 arrives.

- [ ] **C16. CLAUDE [Sonnet]** (after Y20)
  > The Windows signing secrets are set. Cut a Windows release, confirm the installer is signed and the auto-update feed published, and tell me how to test one update.

- [ ] **C17. CLAUDE [Sonnet]**
  > Section 3.6 of docs/launch/GO_LIVE_PLAN.md: write and run the load test (30 tills for 30 minutes) against a staging copy, not production. Report the numbers.

---

## Week 5: real-world trial, iPhone app, voice

- [ ] **Y21. YOU: shadow week.** One friendly restaurant runs Kanda next to
      their current till for a week. Send Claude every problem.

- [ ] **C18. CLAUDE [Sonnet]** (after Y5)
  > Bring PR #41 (Dashboard phone app) up to date with master, get the iOS build signing with my Apple account, and get it onto TestFlight. Tell me each thing you need from me in the Apple developer site.

- [ ] **C19. CLAUDE [Sonnet]** (after Y7)
  > Section 5 of docs/launch/GO_LIVE_PLAN.md: move the voice agent's phone line from Twilio to Plivo behind a provider switch. Keep the agent's tools and prompts unchanged.

- [ ] **C20. CLAUDE [Opus]**
  > Section 5: add Sarvam (speech-to-text plus text-to-speech) as a second voice option beside OpenAI, behind a switch, and write the 30-call test script for the blind comparison in Telugu, Hindi and English.

- [ ] **Y22. YOU: voice test.** Two native speakers make the 30 calls on
      each option and score them. Pick the winner.

---

## Week 6: launch

- [ ] **C21. CLAUDE [Opus]**
  > Do the go/no-go review against docs/launch/GO_LIVE_PLAN.md: for every blocker B1 to B10, show the evidence it is closed. List anything still open and whether it must block launch.

- [ ] **Y23. YOU: submit for review.** Android to Production in Play
      Console; the iPhone Dashboard app to App Review.
- [ ] **Y24. YOU: first paying store.**
- [ ] **Later:** voice agent as an add-on; UrbanPiper (draft PR #48) when
      you sign with them; native iPad till; Driver app.

---

## If you only have 15 minutes right now

1. Submit Y1 (DLT) and Y4 (D-U-N-S). They are the longest waits.
2. Paste prompt C1 into Claude.
