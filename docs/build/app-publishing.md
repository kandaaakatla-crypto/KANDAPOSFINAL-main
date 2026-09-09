# Publishing a build to end users

**Audience:** whoever actually ships a built app to real users — Play
Console access for Android, or distributing the Windows installer. This is
downstream of [release-and-builds.md](release-and-builds.md): read that
first to actually produce a build artifact, then come here for what to do
with it.

## Current signing status (as of 2026-09-09)

| Platform | App | Signed? |
|---|---|---|
| Android | Kanda POS | ✅ Yes — real release keystore configured |
| Android | Kanda Display | ✅ Yes — same keystore (shared by design) |
| Windows | Kanda POS | ❌ No — no code-signing cert configured yet |
| Windows | Kanda Display | ❌ No — same, shared cert slot once one exists |

See [secrets-and-infrastructure.md](secrets-and-infrastructure.md) for
exactly what's configured and what's missing.

## Android — Google Play Console

1. Trigger the build (`build-android.yml` or `build-android-display.yml` —
   see release-and-builds.md) and download the `kanda-pos-release-aab`
   artifact (the `.aab` — this is what Play Console wants, not the `.apk`).
2. In Play Console, upload the `.aab` to whichever track you're releasing to
   (internal testing → closed → open → production).
3. **First upload only:** Play Console will ask whether to use this
   keystore's key directly, or enroll in **Play App Signing** (Google's
   recommendation). With Play App Signing, this keystore becomes your
   *upload key* — you keep signing uploads with it, and Google re-signs the
   app with a separate key it manages for actual distribution. This is
   worth doing: if the upload key is ever compromised or lost after
   enrolling, Google has a key-reset process; without Play App Signing,
   losing this keystore permanently blocks all future updates to the app.
4. The `.apk` artifact from the same build (`kanda-pos-release-apk`) is for
   direct sideloading — QA on a physical device, not for Play Store
   distribution.

There's no automated Play Console upload step in the workflow today — this
is a manual step each release, per the workflow's own header comment ("a
deliberate, versioned artifact ... uploaded to Play Console by hand for
now"). If upload volume ever justifies it, the
[Google Play Developer API](https://developers.google.com/android-publisher)
supports scripting this.

## Windows — installer distribution

Once `WINDOWS_CSC_LINK`/`WINDOWS_CSC_KEY_PASSWORD` are configured (see
secrets-and-infrastructure.md), two things change on the next build:
1. The `.exe` installer gets Authenticode-signed — no more SmartScreen
   warning for end users on install.
2. The "Publish update feed" step (currently skipped — it's gated on
   `if: env.HAS_CSC == 'true'`) starts running, which pushes the signed
   installer + a `latest.yml` manifest to a dedicated Firebase Hosting site:
   - Kanda POS → `kandapos-desktop-releases`
   - Kanda Display → `kandapos-display-releases` (separate site — a Hosting
     deploy replaces a site's entire content each time, so the two apps
     can't share one site without clobbering each other's feed)

   `electron-updater` (already wired into the Electron app) polls that feed
   and offers in-app auto-updates once this is live — nothing else to build
   for that to start working.

**Until signing is set up:** installers are unsigned. Distributing them
still works technically (download the `.exe` artifact, run it), but:
- Windows SmartScreen will warn on install ("Windows protected your PC") —
  expect support questions from anyone not expecting it.
- The auto-update feed doesn't publish at all for an unsigned build, so
  there's no in-app update path — each new version has to be manually
  redistributed until a cert exists.

If you need to distribute a build before a cert is sorted out, that's fine
for internal/beta use — just set expectations with whoever's installing it.

## Getting a Windows code-signing certificate

Not something that can be automated or done by an agent — it requires a
real business identity and payment. Rough process:
1. Buy an Authenticode certificate from a CA — DigiCert, Sectigo, or SSL.com
   are common choices. An **EV (Extended Validation)** cert gets instant
   SmartScreen reputation; a standard OV cert works too but SmartScreen
   trust builds up gradually with download volume over time.
2. Identity verification (business registration documents, sometimes a
   phone call) — this is the part that takes real time, often 1-5 business
   days.
3. You'll end up with a `.pfx`/`.p12` file and a password.
4. Set `WINDOWS_CSC_LINK` (the cert file, base64-encoded or hosted
   somewhere `electron-builder` can fetch it — check `electron-builder`'s
   docs for the exact expected format) and `WINDOWS_CSC_KEY_PASSWORD` as
   GitHub secrets (see secrets-and-infrastructure.md for the `gh secret
   set` command). Both `build-windows.yml` and `build-windows-display.yml`
   pick it up automatically on the next run — no workflow-file changes
   needed.
