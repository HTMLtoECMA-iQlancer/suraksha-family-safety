import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { PolicyKind } from '@suraksha/shared';
import { isoDayOffset } from '@suraksha/shared';
import type { Db } from '../lib/db.js';
import { ah, ApiError, conflict, notFound, rateLimit, validate } from '../lib/http.js';
import { accessibleDevice, assertFamilyAccess, requireUser, skipPath } from '../lib/auth.js';
import { generatePairingCode, pairingCodeHash } from '../lib/crypto.js';
import { revokeDeviceTokens } from '../lib/tokens.js';
import { getPolicies, ensurePolicies, upsertPolicy } from '../lib/defaults.js';
import { recordEvent, writeAudit } from '../lib/events.js';
import {
  devicePatchSchema,
  focusLockSchema,
  pairingCreateSchema,
  policyPayloadSchemas,
} from '../lib/schemas.js';
import {
  groupUsage,
  parseJson,
  toAudit,
  toDevice,
  toEvent,
  toGeofence,
  toLocation,
  toSession,
  type AuditRow,
  type DeviceRow,
  type EventRow,
  type GeofenceRow,
  type LocationRow,
  type SessionRow,
  type UsageRow,
} from '../lib/models.js';
import type { Hub } from '../realtime.js';

interface PairingRow {
  id: string;
  family_id: string;
  child_name: string;
  created_by: string;
  status: 'waiting_child' | 'awaiting_parent' | 'linked' | 'expired' | 'cancelled';
  device_id: string | null;
  expires_at: string;
  created_at: string;
}

function pairingView(row: PairingRow, device?: DeviceRow) {
  return {
    id: row.id,
    status: row.status,
    childName: row.child_name,
    expiresAt: row.expires_at,
    device: device
      ? { id: device.id, name: device.name, model: device.model, platform: device.platform }
      : undefined,
  };
}

async function expirePairingIfNeeded(db: Db, row: PairingRow): Promise<PairingRow> {
  if ((row.status === 'waiting_child' || row.status === 'awaiting_parent') && new Date(row.expires_at).getTime() <= Date.now()) {
    await db.query("UPDATE device_pairings SET status = 'expired' WHERE id = $1", [row.id]);
    return { ...row, status: 'expired' };
  }
  return row;
}

export function deviceRoutes(db: Db, hub: Hub): Router {
  const r = Router();
  r.use(skipPath('/child', requireUser(db)));

  r.get(
    '/devices',
    ah(async (req, res) => {
      const user = (req as any).user;
      const rows = await db.query<DeviceRow>(
        `SELECT d.* FROM devices d
         JOIN family_members m ON m.family_id = d.family_id
         WHERE m.user_id = $1 AND m.status = 'active' AND d.unlinked_at IS NULL
         ORDER BY d.created_at ASC`,
        [user.id],
      );
      res.json({ devices: rows.map((d) => toDevice(d, hub.isDeviceOnline(d.id))) });
    }),
  );

  r.post(
    '/pairings',
    validate(pairingCreateSchema),
    rateLimit({ name: 'pairing', windowMs: 60_000, max: 10 }),
    ah(async (req, res) => {
      const user = (req as any).user;
      const body = req.body as typeof pairingCreateSchema._type;
      let familyId = body.familyId;
      if (!familyId) {
        const rows = await db.query<{ family_id: string }>(
          `SELECT family_id FROM family_members
           WHERE user_id = $1 AND status = 'active' AND role IN ('owner', 'parent')
           ORDER BY created_at ASC LIMIT 1`,
          [user.id],
        );
        if (!rows.length) throw new ApiError(400, 'no_family', 'Create a family first');
        familyId = rows[0].family_id;
      }
      await assertFamilyAccess(db, user.id, familyId, 'write');
      const code = generatePairingCode();
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await db.query(
        `INSERT INTO device_pairings (id, family_id, code_hash, child_name, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, familyId, pairingCodeHash(code), body.childName, user.id, expiresAt],
      );
      await writeAudit(db, {
        familyId,
        actorType: 'parent',
        actorId: user.id,
        action: 'pairing.created',
        metadata: { pairingId: id, childName: body.childName },
      });
      res.status(201).json({ pairing: { id, code, status: 'waiting_child', childName: body.childName, expiresAt } });
    }),
  );

  r.get(
    '/pairings',
    ah(async (req, res) => {
      const user = (req as any).user;
      const rows = await db.query<PairingRow>(
        `SELECT p.* FROM device_pairings p
         JOIN family_members m ON m.family_id = p.family_id
         WHERE m.user_id = $1 AND m.status = 'active'
           AND p.status IN ('waiting_child', 'awaiting_parent')
         ORDER BY p.created_at DESC LIMIT 10`,
        [user.id],
      );
      const out = [];
      for (const row of rows) out.push(await expirePairingIfNeeded(db, row));
      res.json({ pairings: out.map((p) => pairingView(p)) });
    }),
  );

  r.get(
    '/pairings/:id',
    ah(async (req, res) => {
      const user = (req as any).user;
      const rows = await db.query<PairingRow>('SELECT * FROM device_pairings WHERE id = $1', [req.params.id]);
      if (!rows.length) throw notFound('Pairing not found');
      await assertFamilyAccess(db, user.id, rows[0].family_id, 'read');
      const row = await expirePairingIfNeeded(db, rows[0]);
      let device: DeviceRow | undefined;
      if (row.device_id) {
        const devices = await db.query<DeviceRow>('SELECT * FROM devices WHERE id = $1', [row.device_id]);
        device = devices[0];
      }
      res.json({ pairing: pairingView(row, device) });
    }),
  );

  r.post(
    '/pairings/:id/approve',
    ah(async (req, res) => {
      const user = (req as any).user;
      const rows = await db.query<PairingRow>('SELECT * FROM device_pairings WHERE id = $1', [req.params.id]);
      if (!rows.length) throw notFound('Pairing not found');
      const row = await expirePairingIfNeeded(db, rows[0]);
      await assertFamilyAccess(db, user.id, row.family_id, 'write');
      if (row.status !== 'awaiting_parent') {
        throw conflict(
          row.status === 'waiting_child'
            ? 'The child has not entered the pairing code yet'
            : 'This pairing cannot be approved anymore',
        );
      }
      if (!row.device_id) throw conflict('The child device was not registered');
      const now = new Date().toISOString();
      await db.query("UPDATE device_pairings SET status = 'linked' WHERE id = $1", [row.id]);
      await db.query('UPDATE devices SET linked_at = $1, status = $2, last_seen_at = $1 WHERE id = $3', [
        now,
        hub.isDeviceOnline(row.device_id) ? 'online' : 'offline',
        row.device_id,
      ]);
      await ensurePolicies(db, row.family_id, row.device_id, user.id);
      await db.query(
        `INSERT INTO consent_records (id, family_id, device_id, user_id, kind, text_version, granted)
         VALUES ($1, $2, $3, $4, 'parent_pairing_approval', '2026-11-01', true)`,
        [randomUUID(), row.family_id, row.device_id, user.id],
      );
      const devices = await db.query<DeviceRow>('SELECT * FROM devices WHERE id = $1', [row.device_id]);
      const device = devices[0];
      await writeAudit(db, {
        familyId: row.family_id,
        deviceId: row.device_id,
        actorType: 'parent',
        actorId: user.id,
        action: 'device.linked',
        metadata: { pairingId: row.id },
      });
      await recordEvent(db, hub, {
        familyId: row.family_id,
        deviceId: row.device_id,
        kind: 'device.linked',
        severity: 'info',
        title: `${device.name} linked`,
        detail: `Pairing approved for ${device.child_name}'s device`,
      });
      hub.sendToDevice(row.device_id, { type: 'family.changed', data: { familyId: row.family_id } });
      hub.broadcastToFamily(row.family_id, {
        type: 'device.status',
        data: {
          deviceId: device.id,
          status: device.status,
          online: hub.isDeviceOnline(device.id),
          battery: device.battery,
          network: device.network,
          lastSeenAt: device.last_seen_at,
        },
      });
      res.json({ device: toDevice(device, hub.isDeviceOnline(device.id)), pairing: pairingView({ ...row, status: 'linked' }, device) });
    }),
  );

  r.delete(
    '/pairings/:id',
    ah(async (req, res) => {
      const user = (req as any).user;
      const rows = await db.query<PairingRow>('SELECT * FROM device_pairings WHERE id = $1', [req.params.id]);
      if (!rows.length) throw notFound('Pairing not found');
      await assertFamilyAccess(db, user.id, rows[0].family_id, 'write');
      await db.query("UPDATE device_pairings SET status = 'cancelled' WHERE id = $1 AND status IN ('waiting_child','awaiting_parent')", [
        rows[0].id,
      ]);
      res.status(204).end();
    }),
  );

  r.get(
    '/devices/:id',
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'read');
      res.json({ device: toDevice(device, hub.isDeviceOnline(device.id)) });
    }),
  );

  r.patch(
    '/devices/:id',
    validate(devicePatchSchema),
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'write');
      const body = req.body as typeof devicePatchSchema._type;
      const sets: string[] = [];
      const params: unknown[] = [];
      if (body.name !== undefined) {
        params.push(body.name);
        sets.push(`name = $${params.length}`);
      }
      if (body.childName !== undefined) {
        params.push(body.childName);
        sets.push(`child_name = $${params.length}`);
      }
      if (!sets.length) {
        res.json({ device: toDevice(device) });
        return;
      }
      params.push(device.id);
      await db.query(`UPDATE devices SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        actorType: 'parent',
        actorId: user.id,
        action: 'device.updated',
        metadata: body,
      });
      hub.broadcastToFamily(device.family_id, { type: 'family.changed', data: { familyId: device.family_id } });
      res.json({ device: toDevice({ ...device, ...({ name: body.name ?? device.name, child_name: body.childName ?? device.child_name }) }) });
    }),
  );

  r.delete(
    '/devices/:id',
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'write');
      await db.query("UPDATE devices SET unlinked_at = now(), status = 'offline' WHERE id = $1", [device.id]);
      await revokeDeviceTokens(db, device.id);
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        actorType: 'parent',
        actorId: user.id,
        action: 'device.unlinked',
      });
      await recordEvent(db, hub, {
        familyId: device.family_id,
        deviceId: device.id,
        kind: 'device.unlinked',
        severity: 'warning',
        title: `${device.name} unlinked`,
        detail: 'Device access was removed by a parent',
      });
      hub.sendToDevice(device.id, { type: 'device.unlinked', data: { deviceId: device.id } });
      hub.broadcastToFamily(device.family_id, { type: 'device.unlinked', data: { deviceId: device.id } });
      res.status(204).end();
    }),
  );

  r.get(
    '/devices/:id/permissions',
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'read');
      res.json({ permissions: parseJson(device.permission_status, []) });
    }),
  );

  r.get(
    '/devices/:id/policies',
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'read');
      res.json({ policies: await getPolicies(db, device.id) });
    }),
  );

  r.put(
    '/devices/:id/policies/:kind',
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'write');
      const kind = req.params.kind as PolicyKind;
      const schema = (policyPayloadSchemas as Record<string, any>)[kind];
      if (!schema) throw new ApiError(400, 'unknown_policy', 'Unknown policy type');
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, 'validation_error', 'Check the policy values', parsed.error.flatten());
      await upsertPolicy(db, device.family_id, device.id, kind, parsed.data, user.id);
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        actorType: 'parent',
        actorId: user.id,
        action: `policy.updated.${kind}`,
        metadata: {},
      });
      hub.sendToDevice(device.id, { type: 'policy.updated', data: { deviceId: device.id, kind } });
      res.json({ policies: await getPolicies(db, device.id) });
    }),
  );

  r.post(
    '/devices/:id/focus-lock',
    validate(focusLockSchema),
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'write');
      const body = req.body as typeof focusLockSchema._type;
      const until = new Date(Date.now() + body.minutes * 60 * 1000).toISOString();
      await upsertPolicy(db, device.family_id, device.id, 'instant_block', { active: true, until }, user.id);
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        actorType: 'parent',
        actorId: user.id,
        action: 'focus_lock.started',
        metadata: { minutes: body.minutes, until },
      });
      await recordEvent(db, hub, {
        familyId: device.family_id,
        deviceId: device.id,
        kind: 'system.notice',
        severity: 'warning',
        title: 'Focus lock started',
        detail: `${device.child_name}'s device is in a transparent focus lock until ${new Date(until).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
      });
      hub.sendToDevice(device.id, { type: 'policy.updated', data: { deviceId: device.id, kind: 'instant_block' } });
      res.json({ policy: { active: true, until } });
    }),
  );

  r.delete(
    '/devices/:id/focus-lock',
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'write');
      await upsertPolicy(db, device.family_id, device.id, 'instant_block', { active: false, until: null }, user.id);
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        actorType: 'parent',
        actorId: user.id,
        action: 'focus_lock.ended',
      });
      hub.sendToDevice(device.id, { type: 'policy.updated', data: { deviceId: device.id, kind: 'instant_block' } });
      res.json({ policy: { active: false, until: null } });
    }),
  );

  r.get(
    '/devices/:id/overview',
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'read');
      const since = isoDayOffset(6);
      const [usageRows, eventRows, locationRows, fenceRows, sessionRows, policies] = await Promise.all([
        db.query<UsageRow>(
          'SELECT * FROM app_usage_daily WHERE device_id = $1 AND day >= $2 ORDER BY day DESC, minutes DESC',
          [device.id, since],
        ),
        db.query<EventRow>(
          'SELECT * FROM safety_events WHERE device_id = $1 ORDER BY occurred_at DESC LIMIT 10',
          [device.id],
        ),
        db.query<LocationRow>('SELECT * FROM locations WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1', [
          device.id,
        ]),
        db.query<GeofenceRow>('SELECT * FROM geofences WHERE device_id = $1 ORDER BY created_at ASC', [device.id]),
        db.query<SessionRow>('SELECT * FROM session_requests WHERE device_id = $1 ORDER BY created_at DESC LIMIT 10', [
          device.id,
        ]),
        getPolicies(db, device.id),
      ]);
      const usageDays = groupUsage(usageRows);
      const openSession =
        sessionRows.find((s) => ['pending', 'approved', 'active'].includes(s.status)) ?? null;
      res.json({
        device: toDevice(device, hub.isDeviceOnline(device.id)),
        policies,
        usage: { days: usageDays, totalMinutes: usageDays.reduce((sum, d) => sum + d.totalMinutes, 0) },
        events: eventRows.map(toEvent),
        location: locationRows[0] ? toLocation(locationRows[0]) : null,
        geofences: fenceRows.map(toGeofence),
        sessions: sessionRows.map(toSession),
        openSession: openSession ? toSession(openSession) : null,
      });
    }),
  );

  r.get(
    '/devices/:id/events',
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'read');
      const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
      const severity = typeof req.query.severity === 'string' ? req.query.severity : null;
      const rows = severity
        ? await db.query<EventRow>(
            'SELECT * FROM safety_events WHERE device_id = $1 AND severity = $2 ORDER BY occurred_at DESC LIMIT $3',
            [device.id, severity, limit],
          )
        : await db.query<EventRow>('SELECT * FROM safety_events WHERE device_id = $1 ORDER BY occurred_at DESC LIMIT $2', [
            device.id,
            limit,
          ]);
      res.json({ events: rows.map(toEvent) });
    }),
  );

  r.get(
    '/devices/:id/sessions',
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'read');
      const rows = await db.query<SessionRow>(
        'SELECT * FROM session_requests WHERE device_id = $1 ORDER BY created_at DESC LIMIT 100',
        [device.id],
      );
      res.json({ sessions: rows.map(toSession) });
    }),
  );

  r.get(
    '/devices/:id/audit',
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'read');
      const rows = await db.query<AuditRow>(
        `SELECT id, family_id, device_id, session_id, actor_type, actor_id, action, metadata, created_at
         FROM audit_logs WHERE device_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [device.id],
      );
      res.json({ audit: rows.map(toAudit) });
    }),
  );

  r.get(
    '/devices/:id/usage',
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'read');
      const days = Math.min(Math.max(Number(req.query.days ?? 7) || 7, 1), 30);
      const rows = await db.query<UsageRow>(
        'SELECT * FROM app_usage_daily WHERE device_id = $1 AND day >= $2 ORDER BY day DESC, minutes DESC',
        [device.id, isoDayOffset(days - 1)],
      );
      const grouped = groupUsage(rows);
      res.json({ days: grouped, totalMinutes: grouped.reduce((sum, d) => sum + d.totalMinutes, 0) });
    }),
  );

  r.get(
    '/devices/:id/apps',
    ah(async (req, res) => {
      const user = (req as any).user;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'read');
      const rows = await db.query<UsageRow>(
        `SELECT * FROM app_usage_daily WHERE device_id = $1
         ORDER BY day DESC, minutes DESC`,
        [device.id],
      );
      const latest = groupUsage(rows)[0];
      const policies = await getPolicies(db, device.id);
      const rules = new Map(policies.app_rules.rules.map((r) => [r.package, r]));
      res.json({
        apps: (latest?.entries ?? []).map((a) => ({
          ...a,
          blocked: rules.get(a.package)?.blocked ?? false,
          limitMinutes: rules.get(a.package)?.limitMinutes ?? null,
        })),
      });
    }),
  );

  return r;
}
