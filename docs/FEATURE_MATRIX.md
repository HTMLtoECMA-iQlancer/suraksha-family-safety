# Feature matrix

Status key:

- ✅ **Implemented** and exercised in this build
- ⚙️ **Requires configuration** (code exists, deployment setting or external service needed)
- ⚠️ **OS-limited** (works within Android/browser platform rules; behaviour is stated honestly)
- 🔜 **Not in this build** (UI or data model exists, enforcement is not wired yet)
- ⛔ **Not supported by design** (would require covert or unsafe behaviour)

## Parent dashboard (web)

| Feature | Status | Notes |
| --- | --- | --- |
| Responsive layout, Device / Location / Family / My tabs | ✅ | Bottom tabs on phones, sidebar on desktop |
| Device overview: status, battery, network, permissions health | ✅ | Live updates over WebSocket |
| 7-day screen-time and app-usage summaries | ✅ | Fed by Android `UsageStatsManager` reports |
| Screen-time limits and weekly schedule editor | ✅ | Stored per device; see child enforcement row |
| Per-app rules (blocked / limits) | ✅ | Stored and shown to the child; enforcement 🔜 |
| Focus lock (instant block) | ✅ | Timer + audit + warning event; device-side blocking 🔜 |
| Live overview with quick actions (camera, audio, screen, ring location) | ✅ | Session starts after child approval, or instantly for camera/audio when the child enabled quick check-ins |
| Quick check-in badge and start button | ✅ | Shown while the child's standing consent is on; screen stays manual |
| Location map, history slider, latest accuracy | ✅ | Leaflet + OpenStreetMap |
| Geofences: create, edit, enable/disable, delete | ✅ | Enter/exit alerts produced server-side |
| SOS alerts | ✅ | Critical event from child app |
| Driving-speed alerts | ✅ | Server threshold from speed reported with location |
| Safe-browsing rules, categories, allow-list, method disclosure | ✅ | Policy storage and UI; DNS/VPN enforcement 🔜 |
| Content-safety alert feed | ✅ | Displays `content.alert` / `browsing.blocked` events; detection 🔜 |
| Events and notifications lists, filters | ✅ | In-app + WebSocket; FCM ⚙️ see below |
| Family invites (parent/caregiver), role change, remove, leave | ✅ | Owner role cannot be changed or removed |
| Multiple children and caregivers per family | ✅ | One device per child; several devices supported |
| Family audit log and per-device audit | ✅ | Last 200 / 100 entries |
| Pairing code with QR image | ✅ | QR opens the browser child preview; Android enters the 6-character code |
| Export my data (JSON) | ✅ | Account, family, devices, policies, consent, usage, events, location, sessions, audit |
| Delete account / change password / log out | ✅ | Deletion anonymises the user and transfers or removes owned families |
| English and Gujarati UI | ✅ | Main screens translated and persisted per user; a few helper strings remain English |
| Light and dark theme | ✅ | System-aware with manual switch |
| Loading, empty, error and offline states | ✅ | Toasts, skeletons, retry actions |
| Password reset / email verification | 🔜 | `email_verified` is stored; no mail provider is wired |
| Two-factor authentication | ⛔ | Not offered |

## Child Android companion

| Feature | Status | Notes |
| --- | --- | --- |
| Welcome, pairing, permission centre, session inbox, settings, access history | ✅ | Jetpack Compose, bottom navigation |
| Camera live session | ✅ | WebRTC; approval screen + foreground service + Android camera indicator |
| Live audio session | ✅ | Microphone foreground-service type; no recording |
| Quick check-ins switch (standing consent for camera and audio) | ✅ | Off by default; confirmation dialog, consent record, audit, one-tap disable |
| Auto-start of a trusted camera/audio session | ✅ | Starts the visible foreground service without an Approve tap; notification and Stop stay |
| Disabling quick check-ins ends active trusted sessions | ✅ | Server ends them with `endedBy: child` and notifies both sides |
| Screen sharing | ✅ | `MediaProjection` consent dialog **every** session; user can cancel |
| Persistent "session active" notification with **Stop session** action | ✅ | Ongoing, non-dismissible while active |
| Red in-app banner and active-session dialog | ✅ | Child can stop at any time |
| Child-initiated unlink | ✅ | Confirmation dialog; revokes device tokens |
| Permission status reporting and heartbeat | ✅ | Battery, network, app version, permission list |
| App usage reporting | ✅ | Requires Usage access; reports daily totals |
| Location reporting | ⚠️ | While the app is open/foreground; no `ACCESS_BACKGROUND_LOCATION` in this build |
| SOS button | ✅ | Sends a critical event with last known location |
| Access history (who accessed what, when) | ✅ | Reads the device audit trail |
| In-app session/alert notifications | ✅ | While the app is connected over WebSocket |
| FCM push when the app is closed | ⚙️ | `FCM_SERVICE_ACCOUNT_JSON` is a placeholder; Firebase Admin is not bundled |
| Enforce screen-time limits, app rules, focus lock | 🔜 | Policies are delivered and displayed; blocking needs Device Owner or an Accessibility service |
| Safe-browsing filtering | 🔜 | Would require a local VPN/DNS service and a filter list |
| Accessibility-based control | ⛔ | Not used; listed only as an optional future device-owner feature |
| Root/hidden mode, icon disguise, notification suppression | ⛔ | Explicitly prohibited |
| iOS companion | ⛔ | Not built |

## API, security and operations

| Feature | Status | Notes |
| --- | --- | --- |
| REST API with validation and consistent error envelope | ✅ | Zod schemas, `{ error: { code, message, details } }` |
| WebSocket signalling for WebRTC | ✅ | `/ws?token=`; see protocol doc |
| JWT access tokens + rotating refresh tokens | ✅ | 15-minute access, 30-day refresh (90 days for devices) |
| Separate parent and child device principals | ✅ | Device token cannot call parent routes |
| Role-based access (owner / parent / caregiver) | ✅ | Read / write / manage levels, family isolation |
| Rate limits per route group | ✅ | Auth 20/min, invites 20/min, session requests 12/min, global 600/min |
| Audit log + consent records | ✅ | Written for pairing, roles, sessions, policies, geofences, unlink, SOS |
| Retention cleanup | ✅ | Locations 30 days, events 180 days by default (env-configurable) |
| Helmet CSP, CORS allow-list, 1 MB body cap | ✅ | See `server/src/app.ts` |
| Production refuses default `JWT_SECRET` | ✅ | Fails closed |
| PGlite embedded database for local use | ✅ | Data in `./data` |
| PostgreSQL 16 for production | ✅ | `DATABASE_URL`; SQL migrations in `server/migrations` |
| Docker image + docker-compose (Postgres, coturn, API) | ✅ | Built and smoke-tested structure; see deployment doc |
| TURN relay | ⚙️ | Configure `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`; coturn service included |
| STUN | ✅ | Google public STUN by default; override by adding a TURN URL |
| Session recording / screenshots | ⛔ | Never recorded by design |
| Horizontal scaling | ⚠️ | WebSocket hub and timers are in-process; run one API instance or add a shared bus |
| Automated tests | ✅ | Server integration + authz + WebSocket, parent unit tests, Android JVM test; see test report |

## Pairing and session rules (summary)

| Rule | Behaviour |
| --- | --- |
| Pairing code | 6 characters, 10-minute expiry, single use, hashed at rest |
| Child confirmation | Code entry creates a pending device; the child sees "waiting for parent" |
| Parent confirmation | Approval links the device and records consent |
| Session approval | Mandatory on the child device; denial/expiry ends the request |
| Quick check-ins | Child opt-in standing consent for camera/audio only; request is auto-approved (`trusted: true`), screen is never auto-approved |
| Signalling gate | The server relays WebRTC only for `approved` or `active` sessions |
| Visible indicators | Android foreground-service notification, camera/mic indicator, in-app banner |
| Stop control | Child Stop action, parent Stop action, notification action, server expiry |
| Audit | Requested → approved/denied → started → ended, with actor and timestamp |
