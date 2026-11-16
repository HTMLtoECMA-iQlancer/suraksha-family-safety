# Troubleshooting

## Server will not start

**`JWT_SECRET must be set to a strong random value in production`**
`NODE_ENV=production` refuses the built-in development secret. Set a 32+ character
`JWT_SECRET` (see deployment guide).

**Port 4000 already in use**
Another API is running. Stop it or set `PORT` to a free port; the Vite proxy targets
`localhost:4000`, so update `parent-app/vite.config.ts` if you change it.

**PGlite lock or "database is locked"**
PGlite is single-process. Make sure only one API uses `./data`. If the process crashed
and left a lock, stop all Node processes and restart. Keep the folder; do not delete it
unless you intend to reset the demo.

**Corrupt embedded database**
Move the old directory aside instead of deleting it, then restart to let migrations and
the demo seed recreate a fresh database:

```bash
mv data data.backup-$(date +%s)
npm run dev
```

**Migrations fail on PostgreSQL**
Check the database user can create tables in the `public` schema and that no migration
file was edited after it was applied (`schema_migrations`). Restore from backup or add a
new migration instead of changing history.

## Dashboard

**Login says "Your session has expired"**
Access tokens last 15 minutes; the app refreshes automatically, but if you restarted the
API with a different `JWT_SECRET`, old tokens are invalid. Sign in again.

**Demo login fails**
Set `DEMO_MODE=1`, ensure the API can write to `./data`, and restart. Seeding only creates
`demo@suraksha.app` / `Demo1234!` if it does not already exist. To reseed from scratch,
stop the API, move `data/` aside, and start again.

**Blank page after `npm run build` / `npm start`**
`npm start` serves `parent-app/dist`. Run `npm run build` first. Check the API logs for
the static directory path.

**Map tiles do not load**
The CSP allows OpenStreetMap tiles. Corporate networks may block them; the map still
shows markers and coordinates.

**Live session dialog never connects**
- The child device must be online (open app or foreground service).
- The session must be `approved` or `active`; pending sessions cannot signal.
- A restrictive network may need TURN. Configure `TURN_URLS` and coturn; STUN alone
  fails behind symmetric NAT.
- Check both browser consoles and `docker compose logs api` for WebSocket errors.

## Android child app

**Cannot reach the server**
- Emulator: use `http://10.0.2.2:4000` (not `localhost`).
- Physical device: use an HTTPS URL. The network security config allows cleartext only
  for `10.0.2.2`, `localhost` and `127.0.0.1`; for temporary local testing add your
  computer's LAN IP to `android/app/src/main/res/xml/network_security_config.xml`.
- Allow port 4000 through the computer firewall.

**Pairing code rejected**
Codes are 6 characters, expire after 10 minutes, and work once. Create a new code. The
email/account requirement applies to family invites, not device pairing.

**Pairing stays "waiting for your parent"**
The parent must open Family → pending pairing and approve it. Check that the parent is
in the same family and has parent/owner rights.

**No session request appears**
The device must have an open WebSocket (`online`). Battery optimisation can kill the app;
open it again. Android 13+ requires notification permission for the request notification.

**Camera/audio session will not start**
Grant camera and microphone permissions in the app's permission centre. Android 14+
requires the foreground-service types declared in the manifest (already present). For
audio, at least one of the two peers must capture; the child must approve.

**Screen sharing stops immediately**
`MediaProjection` consent must be granted in the system dialog for that session. The
consent cannot be reused silently; this is intentional.

**Child Stop does not clear the banner**
Update to the current APK (`adb install -r ...`). The fixed build ends the foreground
service on the main thread exactly once. If it persists, force-stop and reopen the app,
then check the access history for the session end event.

**Location is not updating**
Location is shared while the app is open and location sharing is enabled by the parent.
This build does not request background location. Check Android location permission and
that the parent policy `location.sharingEnabled` is on.

**Usage numbers are zero**
Grant **Usage access** in Android Settings (Special app access → Usage access). Without
it the app cannot read `UsageStatsManager`.

**Gradle fails with `JAVA_HOME is not set`**
Install JDK 21 and `export JAVA_HOME=/path/to/jdk-21` before `./gradlew`.

**Gradle cannot download dependencies**
The build needs network access to Google Maven and Maven Central the first time. Use a
proxy if required, or retry when the network is stable.

## Tests

**Server tests fail with `EADDRINUSE` or time out**
Each test file starts its own server on an ephemeral port and its own temporary PGlite
directory. Close stray Node processes and rerun `npm --workspace server run test`.
The first run is slower because PGlite initialises per test file.

**`npm --workspace parent-app run test` says "No workspaces found"**
Run it from the repository root, not from inside `parent-app/src`.

## Push notifications

The app currently delivers notifications over the authenticated WebSocket and through the
in-app list. `FCM_SERVICE_ACCOUNT_JSON` is a placeholder; Firebase is not bundled, so no
push arrives when the app is fully closed. This is documented in the feature matrix.

## Data and privacy questions

- Child access history: child app → Settings/Access history.
- Parent audit: dashboard → device audit or Family → audit.
- Export: dashboard → Settings → Export my data.
- Unlink/remove: dashboard device actions or child Settings → Unlink.
- Reset demo data: stop API, move `data/` aside, restart.
