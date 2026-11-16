import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { isInsideGeofence, todayIso } from '@suraksha/shared';
import type { TrustedCheckIn } from '@suraksha/shared';
import type { Db } from '../lib/db.js';
import { ah, conflict, notFound, rateLimit, validate } from '../lib/http.js';
import { requireDevice } from '../lib/auth.js';
import { pairingCodeHash } from '../lib/crypto.js';
import { issueDeviceTokens, revokeDeviceTokens, rotateDeviceRefresh } from '../lib/tokens.js';
import { defaultPermissions, getPolicies } from '../lib/defaults.js';
import { recordEvent, writeAudit } from '../lib/events.js';
import {
  childEventSchema,
  childPairSchema,
  childPermissionsSchema,
  childTokenSchema,
  heartbeatSchema,
  locationReportSchema,
  pushTokenSchema,
  sessionRespondSchema,
  trustedAccessSchema,
  unlinkSchema,
  usageReportSchema,
} from '../lib/schemas.js';
import {
  groupUsage,
  parseJson,
  toDevice,
  toLocation,
  toSession,
  type DeviceRow,
  type GeofenceRow,
  type LocationRow,
  type MemberRow,
  type SessionRow,
  type UsageRow,
} from '../lib/models.js';
import type { Hub } from '../realtime.js';

interface ChildPairingRow {
  id: string;
  family_id: string;
  child_name: string;
  created_by: string;
  status: 'waiting_child' | 'awaiting_parent' | 'linked' | 'expired' | 'cancelled';
  device_id: string | null;
  expires_at: string;
}

const OPEN_STATUSES = ['pending', 'approved', 'active'];

export function childRoutes(db: Db, hub: Hub): Router {
  const r = Router();

  r.post(
    '/child/pair',
    rateLimit({ name: 'child-pair', windowMs: 60_000, max: 12 }),
    validate(childPairSchema),
    ah(async (req, res) => {
      const body = req.body as typeof childPairSchema._type;
      const rows = await db.query<ChildPairingRow>(
        `SELECT * FROM device_pairings WHERE code_hash = $1 LIMIT 1`,
        [pairingCodeHash(body.code)],
      );
      const pairing = rows[0];
      if (!pairing) throw notFound('That pairing code was not found. Check the code and try again.');
      if (pairing.status !== 'waiting_child') {
        throw conflict('This pairing code was already used or cancelled');
      }
      if (new Date(pairing.expires_at).getTime() <= Date.now()) {
        await db.query("UPDATE device_pairings SET status = 'expired' WHERE id = $1", [pairing.id]);
        throw conflict('This pairing code has expired. Ask your parent for a new code.');
      }
      const childName = body.childName?.trim() || pairing.child_name;
      const deviceId = randomUUID();
      const model = body.model?.trim() || (body.platform === 'web-preview' ? 'Browser preview' : 'Android device');
      const name = `${childName}'s ${body.platform === 'web-preview' ? 'preview' : 'phone'}`;
      await db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO devices (id, family_id, child_name, name, model, platform, os_version, app_version, permission_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            deviceId,
            pairing.family_id,
            childName,
            name,
            model,
            body.platform,
            body.osVersion ?? '',
            body.appVersion ?? '',
            JSON.stringify(defaultPermissions()),
          ],
        );
        await tx.query(
          `UPDATE device_pairings SET status = 'awaiting_parent', device_id = $1, consumed_at = now() WHERE id = $2`,
          [deviceId, pairing.id],
        );
        await tx.query(
          `INSERT INTO consent_records (id, family_id, device_id, kind, text_version, granted)
           VALUES ($1, $2, $3, 'child_transparency', '2026-11-01', true)`,
          [randomUUID(), pairing.family_id, deviceId],
        );
      });
      const devices = await db.query<DeviceRow>('SELECT * FROM devices WHERE id = $1', [deviceId]);
      const tokens = await issueDeviceTokens(db, devices[0]);
      await writeAudit(db, {
        familyId: pairing.family_id,
        deviceId,
        actorType: 'child',
        actorId: deviceId,
        action: 'pairing.child_confirmed',
        metadata: { pairingId: pairing.id },
      });
      hub.sendToUser(pairing.created_by, { type: 'family.changed', data: { familyId: pairing.family_id } });
      res.status(201).json({
        deviceId,
        pairingId: pairing.id,
        status: 'awaiting_parent',
        device: toDevice(devices[0], false),
        tokens,
      });
    }),
  );

  r.post(
    '/child/token/refresh',
    validate(childTokenSchema),
    ah(async (req, res) => {
      const { device, tokens } = await rotateDeviceRefresh(db, (req.body as typeof childTokenSchema._type).refreshToken);
      res.json({ tokens, device: toDevice(device, hub.isDeviceOnline(device.id)) });
    }),
  );

  r.use('/child', requireDevice(db));

  r.get(
    '/child/me',
    ah(async (req, res) => {
      const device = req.device!;
      const families = await db.query<{ id: string; name: string }>('SELECT id, name FROM families WHERE id = $1', [
        device.family_id,
      ]);
      const policies = await getPolicies(db, device.id);
      const sessions = await db.query<SessionRow>(
        `SELECT * FROM session_requests WHERE device_id = $1 AND status IN ('pending','approved','active')
         ORDER BY created_at DESC`,
        [device.id],
      );
      const parents = await db.query<MemberRow>(
        `SELECT * FROM family_members WHERE family_id = $1 AND status = 'active' AND role IN ('owner','parent')
         ORDER BY created_at ASC`,
        [device.family_id],
      );
      const pairingRows = await db.query<{ id: string; status: string }>(
        'SELECT id, status FROM device_pairings WHERE device_id = $1 ORDER BY created_at DESC LIMIT 1',
        [device.id],
      );
      res.json({
        device: toDevice(device, hub.isDeviceOnline(device.id)),
        family: families[0] ?? { id: device.family_id, name: 'Family' },
        policies,
        sessions: sessions.map(toSession),
        parents: parents.map((p) => ({ displayName: p.display_name, role: p.role })),
        pairing: pairingRows[0] ?? { id: null, status: device.linked_at ? 'linked' : 'awaiting_parent' },
      });
    }),
  );

  r.post(
    '/child/heartbeat',
    validate(heartbeatSchema),
    ah(async (req, res) => {
      const device = req.device!;
      const body = req.body as typeof heartbeatSchema._type;
      const permissions = body.permissionStatus
        ? body.permissionStatus.map((p) => ({ ...p, updatedAt: new Date().toISOString() }))
        : null;
      const rows = await db.query<DeviceRow>(
        `UPDATE devices SET
           status = 'online',
           last_seen_at = now(),
           battery = COALESCE($1, battery),
           network = COALESCE($2, network),
           app_version = COALESCE($3, app_version),
           permission_status = COALESCE($4, permission_status)
         WHERE id = $5 RETURNING *`,
        [body.battery ?? null, body.network ?? null, body.appVersion ?? null, permissions ? JSON.stringify(permissions) : null, device.id],
      );
      const updated = rows[0];
      hub.broadcastToFamily(device.family_id, {
        type: 'device.status',
        data: {
          deviceId: device.id,
          status: 'online',
          online: true,
          battery: updated.battery,
          network: updated.network,
          lastSeenAt: updated.last_seen_at,
        },
      });
      res.json({ device: toDevice(updated, hub.isDeviceOnline(device.id)) });
    }),
  );

  r.get(
    '/child/permissions',
    ah(async (req, res) => {
      res.json({ permissions: parseJson(req.device!.permission_status, []) });
    }),
  );

  r.post(
    '/child/permissions',
    validate(childPermissionsSchema),
    ah(async (req, res) => {
      const device = req.device!;
      const body = req.body as { key: string; granted: boolean };
      const current = parseJson<any[]>(device.permission_status, []);
      const idx = current.findIndex((p) => p.key === body.key);
      const wasGranted = idx >= 0 ? current[idx].granted : false;
      const entry = {
        key: body.key,
        label: idx >= 0 ? current[idx].label : body.key,
        requiredFor: idx >= 0 ? current[idx].requiredFor : '',
        granted: body.granted,
        updatedAt: new Date().toISOString(),
      };
      if (idx >= 0) current[idx] = entry;
      else current.push(entry);
      await db.query('UPDATE devices SET permission_status = $1 WHERE id = $2', [JSON.stringify(current), device.id]);
      if (wasGranted && !body.granted) {
        await recordEvent(db, hub, {
          familyId: device.family_id,
          deviceId: device.id,
          kind: 'permission.revoked',
          severity: 'warning',
          title: `${device.child_name} turned off ${entry.label}`,
          detail: 'Some safety features will not work until this permission is granted again.',
          metadata: { permission: entry.key },
        });
      }
      hub.broadcastToFamily(device.family_id, { type: 'family.changed', data: { familyId: device.family_id } });
      res.json({ permissions: current });
    }),
  );

  r.get(
    '/child/trusted-access',
    ah(async (req, res) => {
      res.json({
        trustedCheckIn: parseJson<TrustedCheckIn>(req.device!.trusted_check_in, {
          enabled: false,
          kinds: [],
          updatedAt: null,
        }),
      });
    }),
  );

  r.post(
    '/child/trusted-access',
    validate(trustedAccessSchema),
    ah(async (req, res) => {
      const device = req.device!;
      const body = req.body as typeof trustedAccessSchema._type;
      const next: TrustedCheckIn = {
        enabled: body.enabled,
        kinds: body.enabled ? ['camera', 'audio'] : [],
        updatedAt: new Date().toISOString(),
      };
      const rows = await db.query<DeviceRow>(
        'UPDATE devices SET trusted_check_in = $1 WHERE id = $2 RETURNING *',
        [JSON.stringify(next), device.id],
      );
      await db.query(
        `INSERT INTO consent_records (id, family_id, device_id, kind, text_version, granted)
         VALUES ($1, $2, $3, 'trusted_check_in', '2026-11-16', $4)`,
        [randomUUID(), device.family_id, device.id, body.enabled],
      );
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        actorType: 'child',
        actorId: device.id,
        action: body.enabled ? 'trusted_check_in.enabled' : 'trusted_check_in.disabled',
        metadata: { kinds: next.kinds },
      });

      if (!body.enabled) {
        const ended = await db.query<SessionRow>(
          `UPDATE session_requests
           SET status = 'ended', ended_at = now(), ended_by = 'child'
           WHERE device_id = $1 AND status IN ('approved', 'active') AND trusted = true
           RETURNING *`,
          [device.id],
        );
        for (const session of ended) {
          await writeAudit(db, {
            familyId: device.family_id,
            deviceId: device.id,
            sessionId: session.id,
            actorType: 'child',
            actorId: device.id,
            action: 'session.ended',
            metadata: { by: 'child', reason: 'trusted_check_in_disabled' },
          });
          const out = toSession(session);
          hub.sendToUser(session.parent_user_id, { type: 'session.update', data: { session: out } });
          hub.sendToDevice(device.id, { type: 'session.update', data: { session: out } });
        }
      }

      await recordEvent(db, hub, {
        familyId: device.family_id,
        deviceId: device.id,
        kind: 'system.notice',
        severity: body.enabled ? 'info' : 'warning',
        title: body.enabled ? 'Quick check-ins turned on' : 'Quick check-ins turned off',
        detail: body.enabled
          ? `${device.child_name} allowed visible camera and audio quick check-ins without a new approval. Android indicators and Stop stay available.`
          : `${device.child_name} turned off quick check-ins. New camera or audio checks need approval again.`,
        metadata: { trusted: body.enabled, kinds: next.kinds },
      });
      hub.broadcastToFamily(device.family_id, { type: 'family.changed', data: { familyId: device.family_id } });
      res.json({
        trustedCheckIn: parseJson<TrustedCheckIn>(rows[0].trusted_check_in, next),
      });
    }),
  );

  r.get(
    '/child/session-requests',
    ah(async (req, res) => {
      const device = req.device!;
      const policies = await getPolicies(db, device.id);
      const onlyOpen = req.query.status === 'open';
      const rows = await db.query<SessionRow>(
        onlyOpen
          ? `SELECT * FROM session_requests WHERE device_id = $1 AND status IN ('pending','approved','active') ORDER BY created_at DESC`
          : `SELECT * FROM session_requests WHERE device_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [device.id],
      );
      let sessions = rows.map(toSession);
      if (!policies.supervision.shareSessionHistoryWithChild) {
        sessions = sessions.filter((s) => OPEN_STATUSES.includes(s.status));
      }
      res.json({ sessions });
    }),
  );

  r.post(
    '/child/session-requests/:id/respond',
    validate(sessionRespondSchema),
    ah(async (req, res) => {
      const device = req.device!;
      const body = req.body as typeof sessionRespondSchema._type;
      const rows = await db.query<SessionRow>('SELECT * FROM session_requests WHERE id = $1 AND device_id = $2', [
        req.params.id,
        device.id,
      ]);
      if (!rows.length) throw notFound('Session request not found');
      const session = rows[0];
      if (session.status === 'expired') throw conflict('This request already expired');
      if (session.status !== 'pending') throw conflict('This request was already answered');
      if (new Date(session.created_at).getTime() + 120_000 <= Date.now()) {
        const updated = await db.query<SessionRow>(
          `UPDATE session_requests SET status = 'expired', responded_at = now(), ended_at = now(), ended_by = 'system'
           WHERE id = $1 RETURNING *`,
          [session.id],
        );
        hub.sendToUser(session.parent_user_id, { type: 'session.update', data: { session: toSession(updated[0]) } });
        throw conflict('This request expired before it was answered');
      }
      const status = body.approve ? 'approved' : 'denied';
      const updated = await db.query<SessionRow>(
        `UPDATE session_requests SET status = $1, responded_at = now() WHERE id = $2 RETURNING *`,
        [status, session.id],
      );
      await db.query(
        `INSERT INTO consent_records (id, family_id, device_id, kind, text_version, granted)
         VALUES ($1, $2, $3, $4, '2026-11-01', $5)`,
        [randomUUID(), device.family_id, device.id, `session_${session.kind}`, body.approve],
      );
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        sessionId: session.id,
        actorType: 'child',
        actorId: device.id,
        action: body.approve ? 'session.approved' : 'session.denied',
        metadata: { reason: body.reason ?? '' },
      });
      await recordEvent(db, hub, {
        familyId: device.family_id,
        deviceId: device.id,
        kind: body.approve ? 'session.approved' : 'session.denied',
        severity: 'info',
        title: body.approve ? 'Session approved on child device' : 'Session declined on child device',
        detail: body.approve
          ? `${device.child_name} approved the ${session.kind} session request`
          : `${device.child_name} declined the ${session.kind} session request`,
        metadata: { sessionId: session.id, kind: session.kind },
      });
      const out = toSession(updated[0]);
      hub.sendToUser(session.parent_user_id, { type: 'session.update', data: { session: out } });
      hub.sendToDevice(device.id, { type: 'session.update', data: { session: out } });
      res.json({ session: out });
    }),
  );

  r.post(
    '/child/sessions/:id/start',
    ah(async (req, res) => {
      const device = req.device!;
      const rows = await db.query<SessionRow>('SELECT * FROM session_requests WHERE id = $1 AND device_id = $2', [
        req.params.id,
        device.id,
      ]);
      if (!rows.length) throw notFound('Session not found');
      const session = rows[0];
      if (session.status !== 'approved') throw conflict('Session must be approved before starting');
      const updated = await db.query<SessionRow>(
        `UPDATE session_requests SET status = 'active', started_at = now() WHERE id = $1 RETURNING *`,
        [session.id],
      );
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        sessionId: session.id,
        actorType: 'child',
        actorId: device.id,
        action: 'session.started',
      });
      await recordEvent(db, hub, {
        familyId: device.family_id,
        deviceId: device.id,
        kind: 'session.started',
        severity: 'info',
        title: `${session.kind === 'camera' ? 'Camera' : session.kind === 'audio' ? 'Audio' : 'Screen'} session started`,
        detail: `Visible session active on ${device.name}`,
        metadata: { sessionId: session.id },
      });
      const out = toSession(updated[0]);
      hub.sendToUser(session.parent_user_id, { type: 'session.update', data: { session: out } });
      hub.broadcastToFamily(device.family_id, { type: 'session.update', data: { session: out } });
      res.json({ session: out });
    }),
  );

  r.post(
    '/child/sessions/:id/end',
    ah(async (req, res) => {
      const device = req.device!;
      const rows = await db.query<SessionRow>('SELECT * FROM session_requests WHERE id = $1 AND device_id = $2', [
        req.params.id,
        device.id,
      ]);
      if (!rows.length) throw notFound('Session not found');
      const session = rows[0];
      if (!['approved', 'active'].includes(session.status)) throw conflict('Session is not active');
      const updated = await db.query<SessionRow>(
        `UPDATE session_requests SET status = 'ended', ended_at = now(), ended_by = 'child' WHERE id = $1 RETURNING *`,
        [session.id],
      );
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        sessionId: session.id,
        actorType: 'child',
        actorId: device.id,
        action: 'session.ended',
        metadata: { by: 'child' },
      });
      await recordEvent(db, hub, {
        familyId: device.family_id,
        deviceId: device.id,
        kind: 'session.ended',
        severity: 'info',
        title: 'Session stopped from child device',
        detail: `${device.child_name} stopped the ${session.kind} session`,
        metadata: { sessionId: session.id, by: 'child' },
      });
      const out = toSession(updated[0]);
      hub.sendToUser(session.parent_user_id, { type: 'session.update', data: { session: out } });
      hub.sendToDevice(device.id, { type: 'session.update', data: { session: out } });
      res.json({ session: out });
    }),
  );

  r.post(
    '/child/usage',
    validate(usageReportSchema),
    ah(async (req, res) => {
      const device = req.device!;
      const body = req.body as typeof usageReportSchema._type;
      const day = body.day ?? todayIso();
      for (const entry of body.entries) {
        await db.query(
          `INSERT INTO app_usage_daily (id, family_id, device_id, day, package, app_name, category, minutes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (device_id, day, package)
           DO UPDATE SET minutes = $8, app_name = $6, category = $7, updated_at = now()`,
          [
            randomUUID(),
            device.family_id,
            device.id,
            day,
            entry.package,
            entry.appName,
            entry.category,
            entry.minutes,
          ],
        );
      }
      const totals = await db.query<{ total: number }>(
        'SELECT COALESCE(SUM(minutes), 0)::int AS total FROM app_usage_daily WHERE device_id = $1 AND day = $2',
        [device.id, day],
      );
      const policies = await getPolicies(db, device.id);
      if (policies.screen_time.dailyLimitMinutes > 0 && Number(totals[0]?.total ?? 0) >= policies.screen_time.dailyLimitMinutes) {
        const existing = await db.query<{ id: string }>(
          `SELECT id FROM safety_events WHERE device_id = $1 AND kind = 'usage.limit'
           AND occurred_at >= date_trunc('day', now()) LIMIT 1`,
          [device.id],
        );
        if (!existing.length) {
          await recordEvent(db, hub, {
            familyId: device.family_id,
            deviceId: device.id,
            kind: 'usage.limit',
            severity: 'warning',
            title: 'Daily screen-time limit reached',
            detail: `${device.child_name} reached the ${policies.screen_time.dailyLimitMinutes} minute daily limit`,
            metadata: { minutes: Number(totals[0]?.total ?? 0) },
          });
        }
      }
      res.json({ day, totalMinutes: Number(totals[0]?.total ?? 0) });
    }),
  );

  r.get(
    '/child/usage',
    ah(async (req, res) => {
      const device = req.device!;
      const rows = await db.query<UsageRow>(
        'SELECT * FROM app_usage_daily WHERE device_id = $1 ORDER BY day DESC, minutes DESC LIMIT 500',
        [device.id],
      );
      res.json({ days: groupUsage(rows) });
    }),
  );

  r.post(
    '/child/events',
    validate(childEventSchema),
    ah(async (req, res) => {
      const device = req.device!;
      const body = req.body as typeof childEventSchema._type;
      const event = await recordEvent(db, hub, {
        familyId: device.family_id,
        deviceId: device.id,
        kind: body.kind,
        severity: body.severity,
        title: body.title,
        detail: body.detail,
        metadata: body.metadata,
      });
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        actorType: 'child',
        actorId: device.id,
        action: `event.${body.kind}`,
      });
      res.status(201).json({ event });
    }),
  );

  r.post(
    '/child/sos',
    ah(async (req, res) => {
      const device = req.device!;
      const latest = await db.query<LocationRow>(
        'SELECT * FROM locations WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1',
        [device.id],
      );
      const event = await recordEvent(db, hub, {
        familyId: device.family_id,
        deviceId: device.id,
        kind: 'sos.triggered',
        severity: 'critical',
        title: `SOS from ${device.child_name}`,
        detail: `${device.child_name} pressed the SOS button on ${device.name}`,
        metadata: latest[0] ? { lat: latest[0].lat, lng: latest[0].lng } : {},
      });
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        actorType: 'child',
        actorId: device.id,
        action: 'sos.triggered',
      });
      res.status(201).json({ event });
    }),
  );

  r.post(
    '/child/location',
    validate(locationReportSchema),
    ah(async (req, res) => {
      const device = req.device!;
      const body = req.body as typeof locationReportSchema._type;
      const policies = await getPolicies(db, device.id);
      if (!policies.location.sharingEnabled) {
        res.json({ stored: false, reason: 'Location sharing is turned off by the parent' });
        return;
      }
      const previousRows = await db.query<LocationRow>(
        'SELECT * FROM locations WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1',
        [device.id],
      );
      const previous = previousRows[0];
      const recordedAt = body.recordedAt ?? new Date().toISOString();
      await db.query(
        `INSERT INTO locations (id, family_id, device_id, lat, lng, accuracy, speed, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), device.family_id, device.id, body.lat, body.lng, body.accuracy, body.speed ?? null, recordedAt],
      );
      if (!policies.location.historyEnabled) {
        await db.query(
          `DELETE FROM locations WHERE device_id = $1 AND id NOT IN
             (SELECT id FROM locations WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1)`,
          [device.id],
        );
      }
      const cutoff = new Date(Date.now() - policies.location.retentionDays * 24 * 60 * 60 * 1000).toISOString();
      await db.query('DELETE FROM locations WHERE device_id = $1 AND recorded_at < $2', [device.id, cutoff]);

      const fenceRows = await db.query<GeofenceRow>(
        'SELECT * FROM geofences WHERE device_id = $1 AND enabled = true',
        [device.id],
      );
      const point = toLocation({
        id: '',
        family_id: device.family_id,
        device_id: device.id,
        lat: body.lat,
        lng: body.lng,
        accuracy: body.accuracy,
        speed: body.speed ?? null,
        recorded_at: recordedAt,
      });
      hub.broadcastToFamily(device.family_id, {
        type: 'location.update',
        data: { point, deviceName: device.name },
      });

      const alerts = [];
      if (previous) {
        for (const fence of fenceRows) {
          const wasInside = isInsideGeofence({ lat: previous.lat, lng: previous.lng }, {
            lat: fence.lat,
            lng: fence.lng,
            radiusM: fence.radius_m,
          });
          const isInside = isInsideGeofence({ lat: body.lat, lng: body.lng }, {
            lat: fence.lat,
            lng: fence.lng,
            radiusM: fence.radius_m,
          });
          if (wasInside === isInside) continue;
          const entering = isInside;
          if (entering && !fence.notify_on_enter) continue;
          if (!entering && !fence.notify_on_exit) continue;
          const event = await recordEvent(db, hub, {
            familyId: device.family_id,
            deviceId: device.id,
            kind: entering ? 'geofence.enter' : 'geofence.exit',
            severity: 'info',
            title: entering ? `${device.child_name} arrived at ${fence.name}` : `${device.child_name} left ${fence.name}`,
            detail: `Location alert from ${device.name}`,
            metadata: { geofenceId: fence.id, lat: body.lat, lng: body.lng },
          });
          const geofence = {
            id: fence.id,
            familyId: fence.family_id,
            deviceId: fence.device_id,
            name: fence.name,
            lat: fence.lat,
            lng: fence.lng,
            radiusM: fence.radius_m,
            notifyOnEnter: fence.notify_on_enter,
            notifyOnExit: fence.notify_on_exit,
            enabled: fence.enabled,
            createdAt: fence.created_at,
          };
          hub.broadcastToFamily(device.family_id, { type: 'geofence.alert', data: { event, geofence } });
          alerts.push(event);
        }
      }
      if (policies.location.drivingAlerts && body.speed && body.speed > 22) {
        const recent = await db.query<{ id: string }>(
          `SELECT id FROM safety_events WHERE device_id = $1 AND kind = 'driving.speed'
           AND occurred_at >= now() - interval '10 minutes' LIMIT 1`,
          [device.id],
        );
        if (!recent.length) {
          const event = await recordEvent(db, hub, {
            familyId: device.family_id,
            deviceId: device.id,
            kind: 'driving.speed',
            severity: 'warning',
            title: 'High speed detected',
            detail: `${device.child_name}'s device reported about ${Math.round(body.speed * 3.6)} km/h`,
            metadata: { speedMps: body.speed },
          });
          alerts.push(event);
        }
      }
      res.json({ stored: true, alerts, location: point });
    }),
  );

  r.get(
    '/child/access-history',
    ah(async (req, res) => {
      const device = req.device!;
      const rows = await db.query(
        `SELECT id, session_id, actor_type, action, metadata, created_at
         FROM audit_logs WHERE device_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [device.id],
      );
      res.json({ audit: rows });
    }),
  );

  r.post(
    '/child/push-token',
    validate(pushTokenSchema),
    ah(async (req, res) => {
      const device = req.device!;
      const body = req.body as { token: string; platform: string };
      await db.query(
        `INSERT INTO push_tokens (id, device_id, token, platform)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (token) DO UPDATE SET device_id = $2, user_id = NULL, platform = $4, updated_at = now()`,
        [randomUUID(), device.id, body.token, body.platform],
      );
      res.status(204).end();
    }),
  );

  r.post(
    '/child/unlink',
    validate(unlinkSchema),
    ah(async (req, res) => {
      const device = req.device!;
      await db.query("UPDATE devices SET unlinked_at = now(), status = 'offline' WHERE id = $1", [device.id]);
      await revokeDeviceTokens(db, device.id);
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        actorType: 'child',
        actorId: device.id,
        action: 'device.unlinked_by_child',
      });
      await recordEvent(db, hub, {
        familyId: device.family_id,
        deviceId: device.id,
        kind: 'device.unlinked',
        severity: 'warning',
        title: 'Child device unlinked',
        detail: `${device.child_name} unlinked ${device.name}`,
      });
      hub.broadcastToFamily(device.family_id, { type: 'device.unlinked', data: { deviceId: device.id } });
      hub.sendToDevice(device.id, { type: 'device.unlinked', data: { deviceId: device.id } });
      res.status(204).end();
    }),
  );

  return r;
}
