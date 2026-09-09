# Release engineering — triggering builds and deploys

**Audience:** whoever cuts a release or needs a build artifact. You need
write access to this GitHub repo and the ability to trigger GitHub Actions
workflows. You do not need to know the actual values of any secret — see
[secrets-and-infrastructure.md](secrets-and-infrastructure.md) for what's
configured and who owns it.

There are 6 workflows, in `.github/workflows/`. Two auto-deploy on every push
to `master`; four are release builds you trigger deliberately.

## Auto-deploying on every push to `master`

| Workflow | Triggers on | What it does |
|---|---|---|
| `deploy-frontend.yml` | push to `master` touching `KANDAPOSFINAL-main/frontend/**` | Builds the **web** app (`REACT_APP_APP_TARGET` unset → marketing site + `/biz` + `/owner` + storefront) and deploys to Firebase Hosting, live channel. |
| `deploy-backend.yml` | push to `master` touching `KANDAPOSFINAL-main/backend/**` | Builds a Docker image, pushes to Artifact Registry, deploys to **both** Cloud Run regions (asia-south1 for the HTTP API, us-central1 for WebSocket — see the workflow's own comments for why there are two). |
| `test.yml` | every PR + push to `master` | Runs `pytest tests/unit -v` against a throwaway `mongo:7` service container. Reports status but does **not** currently gate `deploy-backend.yml` — a failing test doesn't block a deploy yet. |

Nothing to trigger manually here — just merge to `master`. Both `git push`
directly and a merged PR count as a push.

## Release builds — Windows and Android (4 workflows)

| Workflow | Produces | Tag pattern |
|---|---|---|
| `build-windows.yml` | Windows installer, "Kanda POS" (staff sign-in) | `windows-v*` |
| `build-windows-display.yml` | Windows installer, "Kanda Display" (role picker → KDS/packing/customer display) | `windows-display-v*` |
| `build-android.yml` | Android AAB + APK, "Kanda POS" | `android-v*` |
| `build-android-display.yml` | Android AAB + APK, "Kanda Display" | `android-display-v*` |

These are deliberately **not** triggered by every commit — a desktop/mobile
release is a versioned artifact someone deliberately ships, not something to
rebuild on every backend/frontend change the way the web deploy is.

### ⚠️ The tag-push trigger doesn't actually fire — use `workflow_dispatch` instead

Each of these 4 workflows declares `on: push: tags: ["windows-v*"]` (etc.)
alongside `on: workflow_dispatch: {}`. **In practice, pushing a matching tag
to this repo does not trigger a run** — confirmed directly (pushed
`windows-v1.0.0`/`android-v1.0.0`/etc., waited, checked
`gh api .../actions/runs`, nothing appeared). The tags still exist and are
useful as version markers, but they don't do anything by themselves. This is
most likely a repository/organization Actions permission restricting which
event types can trigger workflows — not a workflow-file bug — but hasn't
been root-caused further.

**What actually works:** trigger the build manually.
```bash
gh workflow run "Build Windows Electron installer" --ref master
gh workflow run "Build signed Android AAB" --ref master
gh workflow run "Build Windows Electron installer (Kanda Display)" --ref master
gh workflow run "Build signed Android AAB (Kanda Display)" --ref master
```
or via the Actions tab → select the workflow → **Run workflow**.

**Recommended process until the tag trigger is fixed:** still create and
push the version tag first (for a real, dated version marker in git
history), then immediately trigger the same commit manually:
```bash
git tag -a windows-v1.1.0 -m "Describe what changed"
git push origin windows-v1.1.0
gh workflow run "Build Windows Electron installer" --ref windows-v1.1.0
```

### Watching a run

```bash
gh run list --workflow="Build signed Android AAB" --limit 3
gh run watch <run-id> --exit-status
```

### Checking whether a build actually signed

All 4 workflows **succeed even when unsigned** — they're written to degrade
gracefully rather than fail when signing credentials are absent (see
[secrets-and-infrastructure.md](secrets-and-infrastructure.md) for current
signing status). A green check does **not** by itself mean the artifact is
signed. To confirm:

```bash
gh run view <run-id> --log | grep -i "ANDROID_KEYSTORE_PATH"
```
- Windows: a real cert produces a signed `.exe`; the "Publish update feed"
  step only runs `if: env.HAS_CSC == 'true'` (only set when a cert was
  actually used) — if that step shows as skipped in the run, the build was
  unsigned.
- Android: `ANDROID_KEYSTORE_PATH: release.keystore` in the log means the
  real keystore was used. An empty value there means it built an unsigned
  AAB/APK instead of failing.

### Downloading a build artifact

```bash
gh run download <run-id>
```
or from the run's page on GitHub → **Artifacts**. Retention is 90 days.

## Build targets — what `REACT_APP_APP_TARGET` does

One React codebase, three different landing experiences, controlled by this
one build-time variable (`frontend/src/App.js`'s `RootRoute()`):

| `REACT_APP_APP_TARGET` | Opens to | Used by |
|---|---|---|
| *(unset)* | Marketing landing page | Web (`deploy-frontend.yml`) |
| `pos` | Staff PIN sign-in | `build-windows.yml`, `build-android.yml` |
| `display` | Role picker (Kitchen Display / Packing / Customer Display) | `build-windows-display.yml`, `build-android-display.yml` |

If you're ever debugging "why does this build show the wrong screen," it's
almost always this variable.

## Versioning convention

There's no enforced version scheme yet — tags are freeform
(`windows-v1.0.0` was the first, chosen as a simple starting point). Pick
whatever convention makes sense going forward (semver is the safe default)
and keep it consistent across the 4 tag prefixes.
