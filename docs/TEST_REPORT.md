# Test report

Run date: 2026-11-16 · Platform: Windows 11 (10.0.22631), Node 24.22.1, JDK 21, Android API 36.1 emulator

## Summary

| Suite | Command | Result |
| --- | --- | --- |
| Server unit/integration/authz/WebSocket | `npm --workspace server run test` | **6 files, 27 tests passed** |
| Parent dashboard unit tests | `npm --workspace parent-app run test` | **2 files, 9 tests passed** |
| Android JVM unit tests | `cd android && ./gradlew testDebugUnitTest` | **2 tests passed** |
| Full root suite | `npm test` | **8 files, 36 tests passed** |
| TypeScript strict check | `npm run typecheck` | **Passed** (server + parent-app) |
| Production builds | `npm run build` | **Passed** (Vite + `tsc`) |
| Android debug APK | `./gradlew assembleDebug` | **BUILD SUCCESSFUL** |

## Environment

- Node.js `v24.22.1`, npm 10+, Windows 11 x64
- Server tests run against isolated PGlite databases in OS temp directories; each test
  file starts its own HTTP server on an ephemeral port
- Android: compile/target SDK 36, min SDK 26, Gradle 8.14.3, Kotlin 2.0.21, JDK 21
- Emulator: `havent2`, 1080×2400, Android 16 / API 36.1

## Server tests (27)

### `server/test/auth.test.ts` — 6 tests
1. Registration creates an owner account and a family, and `GET /me` returns both.
2. Duplicate email returns `409`; weak password returns `400`.
3. Login succeeds with correct credentials and rejects a wrong password with `401`.
4. A protected route without a token returns `401`.
5. Refresh rotation works; reusing the old refresh token returns `401`.
6. Logout revokes the refresh token.

### `server/test/pairing.test.ts` — 4 tests
1. Full handshake: 6-character code → child pairs → `awaiting_parent` → parent approves → `linked`; child `/child/me` and parent device list agree.
2. A pairing code cannot be reused (`409`).
3. A user outside the family cannot approve the pairing (`403`).
4. The parent pairing list exposes the child name while `awaiting_parent`.

### `server/test/session-consent.test.ts` — 6 tests
1. Camera session is approval-gated: pending → duplicate request `409` → early start `409` → approve → start (`active`, `startedAt`) → child end (`endedBy: child`).
2. A denied request cannot be started (`409`).
3. Parent end sets `endedBy: parent`.
4. A different device cannot respond to the request (`404`).
5. A parent token is rejected on child device endpoints (`401`).
6. Audit log contains `session.requested`, `session.approved`, `session.started`, `session.ended`.

### `server/test/rbac.test.ts` — 4 tests
1. Caregiver can read devices but gets `403` for pairing creation (in that family) and device updates.
2. A parent can invite and read members, but only the owner can change roles.
3. Families are isolated: outsider device read/session create `403`/`404`, audit `403`.
4. Owner role cannot be demoted or removed.

### `server/test/realtime.test.ts` — 3 tests
1. Parent and device sockets each receive a correct `hello`.
2. A session request reaches the device; while pending, `webrtc.ready` returns `error: not_approved`; after approval and start, `webrtc.ready` and `signal` relay in both directions.
3. An invalid token is rejected during the WebSocket handshake.

### `server/test/trusted-access.test.ts` — 4 tests
1. Camera is pending before consent; after the child enables quick check-ins the device shows `enabled: true`, a camera request is auto-approved (`trusted: true`), the child can start and end it, and the audit log records `trusted_check_in.enabled` and `session.trusted_started`.
2. Audio auto-approval works; disabling quick check-ins ends an active trusted session with `endedBy: child`; the next request returns to `pending`.
3. Screen requests stay `pending` even while quick check-ins are enabled.
4. A parent token is rejected (`401`) on the child-only trusted-access endpoint.

### Harness
`server/test/helpers.ts` creates a temporary PGlite database per test file, starts the
real Express app and WebSocket server on port `0`, and provides `register`, `pairDevice`,
`heartbeat`, `requestSession` and `call` helpers.

## Parent dashboard tests (9)

### `parent-app/src/format.test.ts` — 5 tests
Duration formatting (English and Gujarati, negatives clamped), byte sizes, initials,
title-case labels, missing timestamps, and "today" detection.

### `parent-app/src/i18n.test.ts` — 4 tests
Gujarati only overrides existing English keys; `{placeholder}` sets match between
languages; no empty strings; navigation, settings and privacy keys exist; more than 150
Gujarati entries.

## Android tests (2)

`android/app/src/test/java/app/suraksha/child/TimeTextTest.kt`

1. Formats minutes, hours and days relative to a fixed clock.
2. Falls back to "just now" for invalid or future timestamps.

The test required extracting the previously private `relativeTime` helper into
`TimeText.kt`; the UI now calls the same function.

## Manual end-to-end verification

Performed on the API at `:4000`, dashboard at `:5173`, and the child app on the emulator:

- Demo login (`demo@suraksha.app`) and dashboard tabs: Device, Location, Family, My/Settings.
- Child device linked and reported online with battery, network and permission health.
- Parent requested a camera session; child received the request, approved it, and Android
  showed the camera privacy indicator plus an ongoing foreground-service notification
  with a **Stop session** action.
- Child pressed **Stop**: server recorded `endedBy: child`; notification, privacy chip and
  red in-app banner cleared; no ANR after the lifecycle fix.
- Quick check-ins: child enabled them in Settings (confirmation dialog, consent record,
  switch shows "On · camera and microphone"). A parent camera request returned
  `status: approved`, `trusted: true`; the child app auto-started the session and showed
  the active-session dialog plus the permanent notification. The parent dashboard showed
  "Quick check-in on", connected over WebRTC and played live video (270×480). The child's
  **Stop session** ended it and the parent dialog showed "Session ended".
- Quick check-ins disabled screen auto-approval: the Screen tab still showed the
  Android-approval notice, required a reason and offered **Send request**.
- Turning quick check-ins off ended any active trusted session and returned later
  requests to `pending`.
- Parent ended a second session via the API: child returned to Home cleanly.
- Child app screens: permissions, access history, settings, unlink confirmation.
- Pairing code flow: code creation, child entry, parent approval, consent record.
- Screenshots in `screenshots/` and `android/screen-*.png`.

An earlier run exposed a real defect: ending a session from the OkHttp thread while
`onDestroy` disposed the WebRTC client could deadlock and leave a stale "session active"
banner. Fixed with an idempotent `dispose()`, main-thread session finish, a re-entrancy
guard, and a session-ID check in the RTC state callback. Re-verified as above.

## Live deployment check (2026-11-16)

Verified against the Render deployment at `https://suraksha-family.onrender.com`
(PostgreSQL, `DEMO_MODE=0`):

- `GET /api/health` → 200, `db: postgres`; `GET /` → 200 serving the built dashboard.
- CORS preflight returns `access-control-allow-origin` for the production origin.
- Registration (`POST /api/auth/register`) → 201; dashboard sign-in loads the device page.
- Child APK built with `-PdefaultServerUrl=https://suraksha-family.onrender.com`,
  installed on the emulator over mobile data: pairing code entry → "Almost paired",
  parent approval → child shows "Connected to your family", device online, network
  "Mobile data", and the parent dashboard shows the linked device with a live heartbeat.
- The demo sign-in card is hidden when the API reports `demoMode: false`.
- Test account and device removed afterwards (`DELETE /api/me` → 204).

## Not covered by automation

- No Compose UI/instrumentation tests (`connectedAndroidTest`) and no Espresso flows;
  Android screens were verified manually on the emulator.
- No browser end-to-end test (Playwright/Cypress); dashboard flows were verified manually.
- No load or soak testing; WebSocket relay has a per-socket message limit but no
  multi-instance scaling tests.
- No automated test of real TURN relay or FCM (FCM is not wired in this build).
- Only one Android API level/emulator was exercised.

## Warnings observed

- Vite reports a single JS chunk of ~682 kB (198 kB gzip) above the 500 kB advisory;
  acceptable for the demo, but route-level code splitting is a sensible next step.
- `Icons.Rounded.ScreenShare` is deprecated in favor of the AutoMirrored variant.
- Gradle reports deprecated features that will need attention for Gradle 9.
- Server logs every request to stdout; use structured logging in production.

## Reproduce

```bash
npm test                 # server + parent-app
npm run typecheck
npm run build
cd android
export JAVA_HOME=/path/to/jdk-21
./gradlew testDebugUnitTest assembleDebug
```

Artifacts: `android/app/build/outputs/apk/debug/app-debug.apk`,
`android/app/build/reports/tests/testDebugUnitTest/index.html`.
