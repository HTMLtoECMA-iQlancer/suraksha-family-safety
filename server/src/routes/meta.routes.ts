import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { NotificationItem } from '@suraksha/shared';
import type { Db } from '../lib/db.js';
import { ah, ApiError, forbidden, notFound, validate } from '../lib/http.js';
import { accessibleDevice, assertFamilyAccess, requireUser } from '../lib/auth.js';
import { issueDeviceTokens } from '../lib/tokens.js';
import { writeAudit } from '../lib/events.js';
import { toDevice, type DeviceRow, type EventRow } from '../lib/models.js';
import { demoChildSessionSchema } from '../lib/schemas.js';
import { env } from '../config.js';
import type { Hub } from '../realtime.js';

export function metaRoutes(db: Db, hub: Hub): Router {
  const r = Router();

  r.get(
    '/notifications',
    requireUser(db),
    ah(async (req, res) => {
      const user = req.user!;
      let familyIds: string[];
      if (typeof req.query.familyId === 'string') {
        await assertFamilyAccess(db, user.id, req.query.familyId, 'read');
        familyIds = [req.query.familyId];
      } else {
        const rows = await db.query<{ family_id: string }>(
          "SELECT family_id FROM family_members WHERE user_id = $1 AND status = 'active'",
          [user.id],
        );
        familyIds = rows.map((row) => row.family_id);
      }
      if (!familyIds.length) {
        res.json({ notifications: [] });
        return;
      }
      const placeholders = familyIds.map((_, i) => `$${i + 1}`).join(',');
      const rows = await db.query<EventRow & { device_name: string | null }>(
        `SELECT e.*, d.name AS device_name FROM safety_events e
         LEFT JOIN devices d ON d.id = e.device_id
         WHERE e.family_id IN (${placeholders})
         ORDER BY e.occurred_at DESC LIMIT 50`,
        familyIds,
      );
      const notifications: NotificationItem[] = rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.detail,
        severity: row.severity,
        deviceId: row.device_id,
        at: row.occurred_at,
        read: false,
      }));
      res.json({ notifications });
    }),
  );

  r.post(
    '/demo/child-session',
    requireUser(db),
    validate(demoChildSessionSchema),
    ah(async (req, res) => {
      if (!env.demoMode) throw notFound('Demo mode is disabled');
      const user = req.user!;
      const body = req.body as typeof demoChildSessionSchema._type;
      const { device } = await accessibleDevice(db, user.id, body.deviceId, 'read');
      const tokens = await issueDeviceTokens(db, device);
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        actorType: 'parent',
        actorId: user.id,
        action: 'demo.child_session_opened',
      });
      res.json({ tokens, device: toDevice(device, hub.isDeviceOnline(device.id)) });
    }),
  );

  r.get(
    '/demo/status',
    requireUser(db),
    ah(async (req, res) => {
      res.json({ demoMode: env.demoMode });
    }),
  );

  return r;
}
