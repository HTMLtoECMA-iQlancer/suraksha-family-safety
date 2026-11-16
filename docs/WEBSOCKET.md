# WebSocket protocol

The dashboard and the child app share one WebSocket endpoint for signalling,
presence, session updates and live events.

## Connect

```
ws://<host>/ws?token=<accessToken>
wss://<host>/ws?token=<accessToken>
```

- The token is a **parent/user** access token or a **child device** token.
- Only the `/ws` path is upgraded; anything else is closed.
- Invalid, expired or revoked tokens are rejected during the HTTP upgrade with `401`.
- The socket stays open only while the client is running. A device counts as "online"
  while it has at least one socket (open child app / foreground service).

## Handshake

Immediately after connecting the server sends:

```json
{
  "type": "hello",
  "data": {
    "kind": "user",
    "clientId": "<userId>",
    "familyIds": ["<familyId>"]
  }
}
```

For a child device:

```json
{
  "type": "hello",
  "data": {
    "kind": "device",
    "clientId": "<deviceId>",
    "familyIds": ["<familyId>"],
    "deviceId": "<deviceId>"
  }
}
```

## Client → server messages

| Type | Shape | Purpose |
| --- | --- | --- |
| `ping` | `{ "type": "ping" }` | Application-level keepalive |
| `webrtc.ready` | `{ "type": "webrtc.ready", "sessionId": "..." }` | Tell the other peer the local peer connection is ready |
| `signal` | `{ "type": "signal", "sessionId": "...", "payload": {...} }` | Opaque WebRTC offer/answer/ICE payload |

Unknown types receive:

```json
{ "type": "error", "data": { "code": "unknown_type", "message": "Unknown message type" } }
```

## Server → client messages

| Type | Shape (summary) |
| --- | --- |
| `hello` | Session identity and family IDs |
| `pong` | Reply to `ping` |
| `device.status` | `{ deviceId, status, online, battery, network, lastSeenAt }` |
| `session.request` | New pending session for the child device |
| `session.update` | Status change for the parent or child |
| `signal` | `{ sessionId, from: "parent" \| "child", payload }` |
| `webrtc.ready` | `{ sessionId, from: "parent" \| "child" }` |
| `event.new` | New safety event |
| `location.update` | `{ point, deviceName }` |
| `geofence.alert` | `{ event, geofence }` |
| `device.unlinked` | Device was unlinked by either side |
| `policy.updated` | `{ deviceId, kind }` |
| `family.changed` | Family/device list changed |
| `error` | `{ code, message }` |

## Signalling rules

`signal` and `webrtc.ready` are relayed only when all of these are true:

1. The `sessionId` exists.
2. The session status is `approved` or `active`. A `pending`, `denied`, `expired`,
   `cancelled` or `ended` session gets `error: not_approved`.
3. The sender is either:
   - the child device that owns the session, or
   - the parent user who created the session.
4. The target is the other side of that same session.

Family membership alone is **not** enough to join a session. A caregiver or sibling
device cannot relay signalling.

Errors you can expect:

| Code | Meaning |
| --- | --- |
| `bad_json` | Message was not valid JSON |
| `bad_signal` | Missing `sessionId` |
| `not_found` | Unknown session |
| `not_approved` | Session is not approved/active yet |
| `forbidden` | Sender is not a party to the session |
| `unknown_type` | Unsupported message type |

## Rate limit and heartbeat

- A socket may send at most **300 messages per minute**; exceeding it closes the socket
  with code `1008` ("Rate limit exceeded").
- The server sends a protocol-level ping every 30 seconds and terminates sockets that do
  not answer. Clients also send application `ping` messages and reconnect on close.
- The Android client reconnects automatically with exponential backoff from 1 s to 20 s
  and sends its own ping every 25 s.

## Presence

Opening a device socket marks the device `online` and broadcasts `device.status` to the
family. Closing the last socket marks it `offline`. A sweep also marks devices offline
when their last heartbeat is older than two minutes and they have no socket.

## Typical camera session

```
Parent                     Server                      Child
  | POST /devices/:id/sessions |                           |
  |-------------------------->| session.request --------->|
  |                           |<-- POST /child/session-requests/:id/respond
  |<-- session.update (approved)                          |
  |                           |<---- POST /child/sessions/:id/start
  |<-- session.update (active)                            |
  | ws: webrtc.ready -------->| webrtc.ready ------------>|
  | ws: signal (offer) ------>| signal ------------------>|
  |<------ signal (answer) ---|<---------------- signal    |
  |<======= encrypted media (WebRTC / TURN) =============>|
  | POST /sessions/:id/end   or   POST /child/sessions/:id/end
  |<-- session.update (ended)                             |
```
