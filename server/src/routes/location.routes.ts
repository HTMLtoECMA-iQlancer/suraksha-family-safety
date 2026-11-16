import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Db } from '../lib/db.js';
import { ah, notFound, validate } from '../lib/http.js';
import { accessibleDevice, requireUser, skipPath } from '../lib/auth.js';
import { getPolicies } from '../lib/defaults.js';
import { writeAudit } from '../lib/events.js';
import { toLocation, type GeofenceRow, type LocationRow } from '../lib/models.js';
import { geofenceCreateSchema, geofenceUpdateSchema } from '../lib/schemas.js';

export function locationRoutes(db: Db): Router {
  const r = Router();
  r.use(skipPath('/child', requireUser(db)));

  r.get(
    '/devices/:id/location',
    ah(async (req, res) => {
      const { device } = await accessibleDevice(db, req.user!.id, req.params.id, 'read');
      const rows = await db.query<LocationRow>(
        'SELECT * FROM locations WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1',
        [device.id],
      );
      const policies = await getPolicies(db, device.id);
      res.json({
        location: rows[0] ? toLocation(rows[0]) : null,
        sharing: policies.location,
      });
    }),
  );

  r.get(
    '/devices/:id/locations',
    ah(async (req, res) => {
      const { device } = await accessibleDevice(db, req.user!.id, req.params.id, 'read');
      const hours = Math.min(Math.max(Number(req.query.hours ?? 24) || 24, 1), 720);
      const rows = await db.query<LocationRow>(
        `SELECT * FROM locations WHERE device_id = $1 AND recorded_at >= now() - ($2 || ' hours')::interval
         ORDER BY recorded_at ASC LIMIT 1000`,
        [device.id, String(hours)],
      );
      res.json({ points: rows.map(toLocation) });
    }),
  );

  r.get(
    '/devices/:id/geofences',
    ah(async (req, res) => {
      const { device } = await accessibleDevice(db, req.user!.id, req.params.id, 'read');
      const rows = await db.query<GeofenceRow>('SELECT * FROM geofences WHERE device_id = $1 ORDER BY created_at ASC', [
        device.id,
      ]);
      res.json({ geofences: rows.map((row) => toGeofence(row)) });
    }),
  );

  r.post(
    '/devices/:id/geofences',
    validate(geofenceCreateSchema),
    ah(async (req, res) => {
      const { device } = await accessibleDevice(db, req.user!.id, req.params.id, 'write');
      const body = req.body as typeof geofenceCreateSchema._type;
      const id = randomUUID();
      await db.query(
        `INSERT INTO geofences (id, family_id, device_id, name, lat, lng, radius_m, notify_on_enter, notify_on_exit, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          device.family_id,
          device.id,
          body.name,
          body.lat,
          body.lng,
          body.radiusM,
          body.notifyOnEnter,
          body.notifyOnExit,
          body.enabled,
        ],
      );
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        actorType: 'parent',
        actorId: req.user!.id,
        action: 'geofence.created',
        metadata: { geofenceId: id, name: body.name },
      });
      const rows = await db.query<GeofenceRow>('SELECT * FROM geofences WHERE id = $1', [id]);
      const g = rows[0];
      res.status(201).json({
        geofence: {
          id: g.id,
          familyId: g.family_id,
          deviceId: g.device_id,
          name: g.name,
          lat: g.lat,
          lng: g.lng,
          radiusM: g.radius_m,
          notifyOnEnter: g.notify_on_enter,
          notifyOnExit: g.notify_on_exit,
          enabled: g.enabled,
          createdAt: g.created_at,
        },
      });
    }),
  );

  r.patch(
    '/geofences/:id',
    validate(geofenceUpdateSchema),
    ah(async (req, res) => {
      const rows = await db.query<GeofenceRow>('SELECT * FROM geofences WHERE id = $1', [req.params.id]);
      if (!rows.length) throw notFound('Geofence not found');
      const existing = rows[0];
      const { device } = await accessibleDevice(db, req.user!.id, existing.device_id, 'write');
      const body = req.body as typeof geofenceUpdateSchema._type;
      const updated = await db.query<GeofenceRow>(
        `UPDATE geofences SET
           name = COALESCE($1, name),
           lat = COALESCE($2, lat),
           lng = COALESCE($3, lng),
           radius_m = COALESCE($4, radius_m),
           notify_on_enter = COALESCE($5, notify_on_enter),
           notify_on_exit = COALESCE($6, notify_on_exit),
           enabled = COALESCE($7, enabled),
           updated_at = now()
         WHERE id = $8 RETURNING *`,
        [
          body.name ?? null,
          body.lat ?? null,
          body.lng ?? null,
          body.radiusM ?? null,
          body.notifyOnEnter ?? null,
          body.notifyOnExit ?? null,
          body.enabled ?? null,
          existing.id,
        ],
      );
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        actorType: 'parent',
        actorId: req.user!.id,
        action: 'geofence.updated',
        metadata: { geofenceId: existing.id },
      });
      const g = updated[0];
      res.json({
        geofence: {
          id: g.id,
          familyId: g.family_id,
          deviceId: g.device_id,
          name: g.name,
          lat: g.lat,
          lng: g.lng,
          radiusM: g.radius_m,
          notifyOnEnter: g.notify_on_enter,
          notifyOnExit: g.notify_on_exit,
          enabled: g.enabled,
          createdAt: g.created_at,
        },
      });
    }),
  );

  r.delete(
    '/geofences/:id',
    ah(async (req, res) => {
      const rows = await db.query<GeofenceRow>('SELECT * FROM geofences WHERE id = $1', [req.params.id]);
      if (!rows.length) throw notFound('Geofence not found');
      const { device } = await accessibleDevice(db, req.user!.id, rows[0].device_id, 'write');
      await db.query('DELETE FROM geofences WHERE id = $1', [rows[0].id]);
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        actorType: 'parent',
        actorId: req.user!.id,
        action: 'geofence.deleted',
        metadata: { geofenceId: rows[0].id, name: rows[0].name },
      });
      res.status(204).end();
    }),
  );

  return r;
}

function toGeofence(row: GeofenceRow) {
  return {
    id: row.id,
    familyId: row.family_id,
    deviceId: row.device_id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    radiusM: row.radius_m,
    notifyOnEnter: row.notify_on_enter,
    notifyOnExit: row.notify_on_exit,
    enabled: row.enabled,
    createdAt: row.created_at,
  };
}
