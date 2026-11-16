# Backup and restore

## What to back up

| Item | Location | Contains |
| --- | --- | --- |
| Database | PostgreSQL, or `./data` for PGlite | Accounts, families, devices, policies, usage, events, locations, sessions, audit, consent |
| Secrets | `.env` or your secret manager | `JWT_SECRET`, database and TURN credentials, FCM path |
| Uploaded/config | Nothing else is stored on disk | Session media is never recorded |

Back up secrets separately from the database. A database restored without the original
`JWT_SECRET` invalidates all sessions but preserves data; users simply sign in again.

## PostgreSQL

Dump (compressed, schema + data):

```bash
pg_dump --format=custom --file=suraksha-$(date +%Y%m%d-%H%M).dump "$DATABASE_URL"
```

Restore into a new database:

```bash
createdb suraksha_restore
pg_restore --dbname=postgresql://user:pass@host:5432/suraksha_restore \
  --clean --if-exists suraksha-YYYYmmdd-HHMM.dump
```

Point `DATABASE_URL` at the restored database, start the API once so pending migrations
apply, then verify:

```bash
curl -s http://localhost:4000/api/health
# sign in with the demo account (if DEMO_MODE=1) or a real account
```

Recommended cadence: nightly full dump, 7–30 days retained, plus a monthly restore drill.
For low recovery-point objectives, enable PostgreSQL WAL archiving / managed backups.

## Docker volume (PostgreSQL in compose)

```bash
docker compose stop api
docker run --rm \
  -v suraksha-family-safety_suraksha-db:/var/lib/postgresql/data \
  -v "$PWD/backups":/backup \
  alpine tar czf /backup/postgres-volume-$(date +%Y%m%d).tgz -C /var/lib/postgresql/data .
docker compose start api
```

Restore by stopping the stack, extracting the archive back into the volume, and starting
again. Prefer `pg_dump` for logical backups across PostgreSQL versions.

## PGlite (`./data`)

PGlite is an embedded single-process database stored as a directory.

```bash
# Stop the API first — copying while it runs can capture a half-written state.
cp -a data data.backup-$(date +%Y%m%d-%H%M)
```

Restore:

```bash
mv data data.bad-$(date +%s)
cp -a data.backup-YYYYmmdd-HHMM data
npm run dev
```

Do not run two API processes against the same directory. PGlite is suitable for local
use and small single-instance deployments; use PostgreSQL for production scale.

## Test a restore

1. Restore into a separate database or directory.
2. Start the API against it with `DEMO_MODE=0`.
3. Sign in, confirm devices, recent events, usage and audit entries are present.
4. Open one linked device and confirm its last-seen and policies.
5. Delete the test environment afterwards.

## After a restore

- Re-check `TURN_*` and `PUBLIC_BASE_URL`; pairing payloads use the public base URL.
- Confirm `CORS_ORIGINS` matches the deployed dashboard origin.
- Rotate `JWT_SECRET` only if it may have been exposed; everyone signs in again.
- Clear stale push tokens if you changed Firebase projects (re-registration overwrites
  them).
