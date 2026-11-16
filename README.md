# Suraksha — family safety, by consent

Suraksha is a parent–child safety app inspired by AirDroid Kids. It pairs a parent
dashboard with a child Android companion and a secure API. Camera, microphone and
screen sessions run with Android's visible privacy indicators and foreground-service
notification, and can be stopped from the child device at any time.

By default every session needs the child's explicit approval on their own device. The
child can optionally turn on **Quick check-ins** in the child app, a standing consent
that lets a parent start a visible camera or microphone check without a new Approve
tap — useful when a child is in trouble and cannot respond. Quick check-ins never cover
screen sharing, are recorded as consent, and are ended by the child's Stop or by
switching the setting off.

![Parent dashboard](screenshots/dashboard-mobile.png)

## What runs where

| Piece | Path | Stack |
| --- | --- | --- |
| Parent dashboard | `parent-app/` | React 19, TypeScript, Vite, Leaflet |
| REST API + WebSocket signalling | `server/` | Express 4, PGlite or PostgreSQL, `ws`, JWT |
| Child Android companion | `android/` | Kotlin, Jetpack Compose, WebRTC, foreground service |
| Browser child preview | `parent-app/src/pages/ChildPreviewPage.tsx` (`/child`) | Same React app, for demos without a phone |
| Shared contracts | `shared/` | Types, labels, policy shapes |

## Quick start (local)

```bash
npm install
cp .env.example .env        # already present in this checkout
npm run dev                 # API on :4000, dashboard on :5173
```

Open http://localhost:5173 and sign in with the demo family:

- **Email:** `demo@suraksha.app`
- **Password:** `Demo1234!`

The demo seed adds Meera Shah (owner), a caregiver, two child devices, usage history,
geofences, alerts and audit entries. Demo mode is `DEMO_MODE=1`, which is the default
outside production. Delete the `data/` directory and restart the API to reseed.

Health check: `GET http://localhost:4000/api/health` → `{"status":"ok","db":"pglite",...}`.
The API also serves the built dashboard from `parent-app/dist` in production.

### Android child app

```bash
export JAVA_HOME=/path/to/jdk-21        # Gradle needs a JDK 21
cd android
./gradlew testDebugUnitTest assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The child app defaults to `http://10.0.2.2:4000` (your computer from the Android
emulator). Change it on the pairing screen or in Settings. For a physical device use an
HTTPS URL, or add your computer's LAN IP to
`android/app/src/main/res/xml/network_security_config.xml` for local cleartext testing.
Then enter the 6-character code shown in the parent dashboard under **Family → Add child**.

## All commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | API (watch) + Vite dashboard together |
| `npm run dev:server` / `npm run dev:web` | Run one side only |
| `npm test` | Server integration suite + parent-app unit tests |
| `npm run typecheck` | TypeScript strict check for server and parent-app |
| `npm run build` | Production build of dashboard and API |
| `npm start` | Serve the built API and dashboard on `:4000` |
| `npm run seed` | Reseed demo data (server) |
| `cd android && ./gradlew assembleDebug` | Build the child APK |

Docker (PostgreSQL + coturn + API): see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## How pairing and live sessions work

1. Parent creates a pairing code (6 characters, 10-minute expiry) for a named child.
2. Child enters the code in the Android app. The pairing waits for parent approval —
   the child sees "waiting for your parent".
3. Parent approves. The device is linked, a consent record is written, and the child
   sees the linked state. Either side can unlink later.
4. For camera, audio or screen sharing the parent sends a request. The child sees it in
   the session inbox and must tap **Approve**. Until then the server refuses to relay
   any WebRTC signalling.
5. If the child turned on **Quick check-ins** (Settings → Quick check-ins), a camera or
   audio request is auto-approved and the child app starts the session itself. Screen
   sharing is never auto-approved because Android asks the child for screen consent.
6. While active, Android shows a persistent foreground-service notification with a
   **Stop session** action and the system privacy indicators. The child app shows a red
   "session active" banner and an active-session dialog. **Stop** on either side ends the
   session for both.
7. Every step is written to the family audit log and the child's access history. The
   child can switch quick check-ins off at any time, which also ends an active
   quick check-in session.

There is no hidden capture, no icon disguise, no notification suppression, and no
session can start without either the child's per-session approval or the child's own
standing consent.

## Testing over mobile data

The APK defaults to `http://10.0.2.2:4000`, which only works from the Android emulator.
To use a real phone on Wi-Fi or mobile data, give the app a public HTTPS URL at build
time:

```bash
cloudflared tunnel --url http://localhost:4000
cd android
./gradlew assembleDebug -PdefaultServerUrl=https://your-tunnel.trycloudflare.com
```

Open the app's Settings → Server URL to change it later without rebuilding. A
trycloudflare quick tunnel gets a new hostname every time it restarts, so rebuild (or
update the setting) after a restart. For a permanent address, deploy the API as
described in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and build the APK with that URL.
`-PdefaultServerUrl` only affects fresh installs; an installed app keeps the URL saved
in its settings.

## Documentation

- [Feature matrix](docs/FEATURE_MATRIX.md) — what is implemented, OS-limited, needs configuration, or intentionally unsupported
- [OpenAPI specification](docs/openapi.yaml) — every REST endpoint
- [WebSocket protocol](docs/WEBSOCKET.md) — handshake, messages, relay rules
- [Deployment](docs/DEPLOYMENT.md) — PostgreSQL, coturn/TURN, pushes, Docker, secrets
- [Privacy policy](docs/PRIVACY.md) — data map, retention, export/delete
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Backup and restore](docs/BACKUP_RESTORE.md)
- [Test report](docs/TEST_REPORT.md) — commands and actual results

## Security notes

- Access tokens are short-lived JWTs (15 min); refresh tokens rotate and are stored hashed.
- Passwords use scrypt; device tokens are separate from parent tokens.
- Role checks: `caregiver` can read, `parent` can write, `owner` can manage members.
- Helmet CSP, CORS allow-list, per-route rate limits, request size limit (1 MB).
- In production the server refuses to start without a strong `JWT_SECRET`.
- `FCM_SERVICE_ACCOUNT_JSON` is a placeholder for adding Firebase; this build uses
  authenticated WebSocket + in-app notifications (see the feature matrix).

Suraksha is a safety and communication tool, not a covert monitoring product. Use it
only with the knowledge and consent of the person using the child device.
