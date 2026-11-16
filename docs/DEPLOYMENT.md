# Deployment guide

## 1. Prerequisites

- Node.js 20 or newer and npm 10+
- PostgreSQL 16 for production (local development can use the embedded PGlite engine)
- Docker + Docker Compose if you want the packaged stack
- JDK 21 and Android SDK for building the child APK

## 2. Environment variables

Copy `.env.example` to `.env` and set every secret. The server searches up to five
parent directories for `.env`, so it also works when started from `server/`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Yes | `production` disables demo seeding and enforces `JWT_SECRET` |
| `PORT` | No | API port, default `4000` |
| `JWT_SECRET` | Production | 32+ random characters; server refuses the built-in dev secret in production |
| `DATABASE_URL` | Production | `postgres://user:pass@host:5432/db`. Empty = PGlite in `./data` |
| `CORS_ORIGINS` | Yes | Comma-separated browser origins, e.g. `https://family.example.com` |
| `DEMO_MODE` | No | `1` seeds the demo family; keep `0` in production |
| `PUBLIC_BASE_URL` | Yes | Public URL used in pairing payloads |
| `TURN_URLS` | Recommended | Comma-separated TURN URLs, e.g. `turn:turn.example.com:3478?transport=udp` |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | With TURN | Long-term credentials for coturn |
| `FCM_SERVICE_ACCOUNT_JSON` | Optional | Reserved for Firebase push; not consumed in this build |
| `LOCATION_RETENTION_DAYS` | No | Default `30` |
| `EVENT_RETENTION_DAYS` | No | Default `180` |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Never commit `.env`. `.gitignore` already excludes it. In Docker, inject secrets through
your orchestrator or an env file with restricted permissions, not through the image.

## 3. Local (no Docker)

```bash
npm ci
cp .env.example .env        # set JWT_SECRET even locally if you like
npm run dev                 # API :4000, dashboard :5173
```

Production-style single process:

```bash
npm run build
NODE_ENV=production npm start   # serves API + dashboard on :4000
```

Migrations run automatically on boot from `server/migrations`. The demo seed runs only
when `DEMO_MODE=1` and no demo user exists.

## 4. PostgreSQL

```sql
CREATE DATABASE suraksha;
CREATE USER suraksha WITH ENCRYPTED PASSWORD 'change-me';
GRANT ALL PRIVILEGES ON DATABASE suraksha TO suraksha;
```

Set `DATABASE_URL=postgres://suraksha:change-me@localhost:5432/suraksha` and start the
API. `schema_migrations` tracks applied files. Back up before upgrading; see
[BACKUP_RESTORE.md](BACKUP_RESTORE.md).

PGlite is single-process. Do not run two API processes against the same `./data`
directory.

## 5. Docker Compose

`docker-compose.yml` starts PostgreSQL 16, coturn and the API built from `Dockerfile`.

```bash
cp .env.example .env
# edit .env: JWT_SECRET, POSTGRES_PASSWORD, TURN_USERNAME, TURN_CREDENTIAL,
#            PUBLIC_BASE_URL, CORS_ORIGINS, DEMO_MODE=0
docker compose up --build -d
docker compose logs -f api
```

The API is published on `:4000`. The image runs as the unprivileged `node` user and
serves the built dashboard.

## 6. TURN / coturn

Public STUN is enough on many home networks. Carrier-grade NAT, corporate firewalls and
some mobile networks need a relay. The compose file includes a coturn service; open:

- `3478/tcp` and `3478/udp`
- the UDP relay range `49160-49200/udp`

Set the matching values for the API:

```env
TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
TURN_USERNAME=suraksha
TURN_CREDENTIAL=<long-random-value>
```

The dashboard fetches these from `GET /api/config` and adds them to `RTCPeerConnection`
alongside STUN. For internet-facing coturn also configure `--external-ip` and TLS
(`turns:`) behind a load balancer. Media flows peer-to-peer or through your TURN server;
the API only carries signalling.

## 7. Reverse proxy

Terminate TLS in front of the API and forward both HTTP and WebSocket upgrades:

```nginx
server {
    listen 443 ssl;
    server_name family.example.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
```

Set `CORS_ORIGINS=https://family.example.com` and `PUBLIC_BASE_URL=https://family.example.com`.
Trust proxy is enabled, so rate limits and logs see the real client address.

## 8. Android child app

Debug build and install:

```bash
export JAVA_HOME=/path/to/jdk-21
cd android
./gradlew testDebugUnitTest assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Release build (requires your own keystore; none is included):

```bash
cd android
./gradlew assembleRelease \
  -Pandroid.injected.signing.store.file=/secure/keystore.jks \
  -Pandroid.injected.signing.store.password=... \
  -Pandroid.injected.signing.key.alias=... \
  -Pandroid.injected.signing.key.password=...
```

Point the app at your API on the pairing/settings screen. The emulator default is
`http://10.0.2.2:4000`. The network security config permits cleartext only for
`10.0.2.2`, `localhost` and `127.0.0.1`. For a physical device, use HTTPS in production;
for local testing, temporarily add your computer's LAN IP to
`android/app/src/main/res/xml/network_security_config.xml`.

## 9. Firebase push (optional, not wired)

`FCM_SERVICE_ACCOUNT_JSON` exists so the deployment shape is ready, but this build does
not bundle Firebase Admin and does not send FCM messages. Notifications currently arrive
through the authenticated WebSocket while the app or dashboard is connected, plus the
in-app notification list. Adding FCM requires: Firebase project + service account,
`firebase-admin` on the server, token registration (routes already exist at
`/me/push-token` and `/child/push-token`), and send calls on event creation.

## 10. Operations checklist

- [ ] Strong `JWT_SECRET`, database password and TURN credential
- [ ] `DEMO_MODE=0`
- [ ] HTTPS everywhere; `CORS_ORIGINS` restricted to your domain
- [ ] TURN reachable from mobile networks
- [ ] Database backups scheduled and restore tested
- [ ] Log aggregation for `[suraksha]` request lines
- [ ] Retention values reviewed with your privacy policy
- [ ] One API instance, or a shared WebSocket bus before scaling out
- [ ] Child devices enrolled with informed consent; privacy policy shared with the family
