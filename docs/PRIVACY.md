# Privacy policy (template)

> This is a plain-language template for the Suraksha build in this repository. Replace
> the contact and jurisdiction details before publishing it to real families.

## Our promise

Suraksha helps a family stay in touch about safety. It is **not** a covert monitoring
tool. The child using the paired device can always see when the app is linked, when a
session is requested, and when a camera, microphone or screen session is active. The
child can stop any session and unlink the device. If the child chooses to enable quick
check-ins, the same visible indicators, notification and Stop control still apply to
every session. We do not hide the app, disguise its icon, suppress Android's privacy
indicators, or collect data secretly.

## What we collect

| Data | When | Why |
| --- | --- | --- |
| Account: email, display name, phone (optional), password hash, locale | Registration and settings | Sign-in and family communication |
| Family: name, members, roles, invite status | Family setup | Sharing devices with the right caregivers |
| Device: child name, device model, OS and app version, battery, network, last seen | Heartbeat and linking | Show device status and keep the link healthy |
| Permissions: which Android permissions are granted | Heartbeat | Show parents what the device can currently do |
| Usage: per-app minutes per day | If Usage access is granted | Screen-time summaries and limit alerts |
| Location: latitude, longitude, accuracy, speed, time | While the child app is open and location sharing is on | Map, history, geofences, driving alerts |
| Safety events: geofence enter/exit, SOS, speed, usage limit, permission changes | As they happen | Alerts and the event list |
| Sessions: request, approval or denial, start/end, who ended it | Every live session | Transparency and audit |
| Audit log: who changed what, when | Every sensitive action | Accountability for parents and children |
| Push tokens | If a push token is registered | Delivering alerts (see note below) |

Session media (camera, microphone, screen) is transmitted live over WebRTC, peer-to-peer
or through the configured TURN relay. **It is not recorded or stored by Suraksha.**

## What we never collect

- No keylogging, clipboard capture, SMS/call-log reading, or contact harvesting.
- No hidden camera, microphone or screen capture; no recording of live sessions.
- No location tracking while the app is closed (this build has no background-location
  permission) and no tracking when the parent turns sharing off.
- No advertising identifiers and no sale of personal data.

## Who can see what

- **Family members** with an active role see the devices in their family. Caregivers
  have read access; parents can change devices and policies; owners can manage members.
- **The child** sees the linked state, incoming requests, active-session indicators, the
  permissions in use, and their own access history.
- **Other families** cannot see your data; every request is authorised against family
  membership.
- **Service providers** process only what is needed: your hosting/database provider, your
  TURN relay (encrypted media relay, no storage), and — only if you configure it — your
  Firebase project for push. We do not share data with advertisers or data brokers.

## Consent and control

- Pairing requires the child to enter a code and the parent to approve the link.
- By default, camera, audio and screen sessions start only after the child taps
  **Approve** on the device, for every session.
- **Quick check-ins (optional, child-controlled):** the child can turn on a standing
  consent in the child app. While it is on, a parent's camera or microphone request
  starts immediately without another Approve tap. It is limited to camera and audio,
  it is recorded as a consent record, and it can be turned off by the child at any time.
  Turning it off ends any active quick check-in session.
- Screen sharing can never be covered by quick check-ins: Android requires the child to
  confirm its own screen-capture prompt for every screen session.
- Android shows its camera/microphone/screen indicators and a permanent notification
  with a **Stop session** action while a session is active — including quick check-ins.
  The child can stop any session from the in-app dialog or the notification.
- The child can revoke permissions in Android Settings or unlink the device. Unlinking
  revokes the device tokens immediately.
- Parents can unlink a device, turn off location sharing or history, and export or delete
  their account.

## Retention

| Data | Default retention |
| --- | --- |
| Location points | 30 days (`LOCATION_RETENTION_DAYS`) |
| Safety events | 180 days (`EVENT_RETENTION_DAYS`) |
| Usage summaries | Kept with the device until the family/device is deleted |
| Sessions, audit logs, consent records | Kept with the family until deletion |
| Refresh tokens | Rotated; expired entries cleaned weekly |
| Expired pairing codes | Cleaned one day after expiry |

When a family is deleted, its devices, policies, usage, events, locations, geofences,
sessions, consents and audit entries are removed by database cascade rules. When a user
deletes their account, the email and password are replaced with unusable values, their
memberships are revoked, and owned families are transferred to another parent or deleted
if no other parent exists. Audit entries may remain as part of the family's safety history.

## Your rights

- **Export:** Settings → *Export my data* downloads a JSON file with your account,
  family, devices, policies, consent records, usage, events, locations, sessions and audit.
- **Delete:** Settings → *Delete account* requires your password and removes your account.
- **Correct:** edit your display name, phone and language in Settings.
- **Withdraw consent:** unlink the child device, revoke Android permissions, or stop
  location sharing at any time.

## Security

Passwords are hashed with scrypt. Access tokens are short-lived; refresh tokens rotate
and are stored hashed. Transport should use HTTPS/WSS in production. Role checks,
rate limits, request-size limits, CSP headers and a production secret check are built in.
No system is perfectly secure; report suspected issues to the contact below.

## Children's privacy

The child device is enrolled with the child's knowledge and approval. The app explains
what is visible and shared. Do not use Suraksha to monitor another adult or a person who
has not consented. Parents remain responsible for using the product lawfully and
respectfully.

## Contact and changes

- Contact: _privacy@example.com_ (replace before publishing)
- Address: _your organisation address_
- We will announce material changes in the app and update the version date.

Last updated: 2026-11-16
