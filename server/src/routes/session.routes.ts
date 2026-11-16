import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { SESSION_LABELS } from '@suraksha/shared';
import type { TrustedCheckIn } from '@suraksha/shared';
import type { Db } from '../lib/db.js';
import { ah, conflict, forbidden, notFound, rateLimit, validate } from '../lib/http.js';
import { accessibleDevice, requireUser, skipPath } from '../lib/auth.js';
import { recordEvent, writeAudit } from '../lib/events.js';
import { parseJson, toSession, type DeviceRow, type SessionRow } from '../lib/models.js';
import { sessionCreateSchema, sessionEndSchema } from '../lib/schemas.js';
import type { Hub } from '../realtime.js';

export function sessionRoutes(db: Db, hub: Hub): Router {
  const r = Router();
  r.use(skipPath('/child', requireUser(db)));

  r.post(
    '/devices/:id/sessions',
    rateLimit({ name: 'session-request', windowMs: 60_000, max: 12 }),
    validate(sessionCreateSchema),
    ah(async (req, res) => {
      const user = req.user!;
      const { device } = await accessibleDevice(db, user.id, req.params.id, 'read');
      const body = req.body as typeof sessionCreateSchema._type;
      if (!hub.isDeviceOnline(device.id) && device.status !== 'online') {
        throw conflict('The child device is offline. Ask them to open the Suraksha Child app, then try again.');
      }
      const open = await db.query<SessionRow>(
        `SELECT * FROM session_requests WHERE device_id = $1 AND status IN ('pending','approved','active') ORDER BY created_at DESC LIMIT 1`,
        [device.id],
      );
      if (open.length) throw conflict('A session request is already open for this device');
      const trustedState = parseJson<TrustedCheckIn>(device.trusted_check_in, {
        enabled: false,
        kinds: [],
        updatedAt: null,
      });
      const trustedStart =
        trustedState.enabled && body.kind !== 'screen' && trustedState.kinds.includes(body.kind);
      const status = trustedStart ? 'approved' : 'pending';
      const respondedAt = trustedStart ? new Date().toISOString() : null;
      const id = randomUUID();
      const rows = await db.query<SessionRow>(
        `INSERT INTO session_requests
           (id, family_id, device_id, parent_user_id, parent_name, kind, status, reason, trusted, responded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          id,
          device.family_id,
          device.id,
          user.id,
          user.display_name,
          body.kind,
          status,
          body.reason,
          trustedStart,
          respondedAt,
        ],
      );
      const session = toSession(rows[0]);
      await writeAudit(db, {
        familyId: device.family_id,
        deviceId: device.id,
        sessionId: id,
        actorType: 'parent',
        actorId: user.id,
        action: trustedStart ? 'session.trusted_started' : 'session.requested',
        metadata: { kind: body.kind, reason: body.reason, trusted: trustedStart },
      });
      await recordEvent(db, hub, {
        familyId: device.family_id,
        deviceId: device.id,
        kind: 'session.requested',
        severity: 'info',
        title: `${SESSION_LABELS[body.kind]} ${trustedStart ? 'quick check-in started' : 'requested'}`,
        detail: trustedStart
          ? `${user.display_name} started a visible ${body.kind} quick check-in under the child's standing consent. Android shows a notification and the child can stop it.`
          : `${user.display_name} requested a visible ${body.kind} session. It starts only after the child approves.`,
        metadata: { sessionId: id, kind: body.kind, trusted: trustedStart },
      });
      hub.sendToDevice(device.id, { type: 'session.request', data: { session } });
      hub.sendToUser(user.id, { type: 'session.update', data: { session } });
      res.status(201).json({ session });
    }),
  );

  r.get(
    '/sessions/:id',
    ah(async (req, res) => {
      const rows = await db.query<SessionRow>('SELECT * FROM session_requests WHERE id = $1', [req.params.id]);
      if (!rows.length) throw notFound('Session not found');
      if (rows[0].parent_user_id !== req.user!.id) throw forbidden('This session belongs to another parent');
      res.json({ session: toSession(rows[0]) });
    }),
  );

  r.post(
    '/sessions/:id/cancel',
    ah(async (req, res) => {
      const rows = await db.query<SessionRow>('SELECT * FROM session_requests WHERE id = $1', [req.params.id]);
      if (!rows.length) throw notFound('Session not found');
      const session = rows[0];
      if (session.parent_user_id !== req.user!.id) throw forbidden('This session belongs to another parent');
      if (session.status !== 'pending') throw conflict('Only a pending request can be cancelled');
      const updated = await db.query<SessionRow>(
        `UPDATE session_requests SET status = 'cancelled', responded_at = now(), ended_at = now(), ended_by = 'parent'
         WHERE id = $1 RETURNING *`,
        [session.id],
      );
      await writeAudit(db, {
        familyId: session.family_id,
        deviceId: session.device_id,
        sessionId: session.id,
        actorType: 'parent',
        actorId: req.user!.id,
        action: 'session.cancelled',
      });
      const out = toSession(updated[0]);
      hub.sendToDevice(session.device_id, { type: 'session.update', data: { session: out } });
      hub.sendToUser(req.user!.id, { type: 'session.update', data: { session: out } });
      res.json({ session: out });
    }),
  );

  r.post(
    '/sessions/:id/end',
    validate(sessionEndSchema),
    ah(async (req, res) => {
      const body = req.body as typeof sessionEndSchema._type;
      const rows = await db.query<SessionRow>('SELECT * FROM session_requests WHERE id = $1', [req.params.id]);
      if (!rows.length) throw notFound('Session not found');
      const session = rows[0];
      if (session.parent_user_id !== req.user!.id) throw forbidden('This session belongs to another parent');
      if (session.status !== 'active' && session.status !== 'approved') {
        throw conflict('This session is not active');
      }
      const updated = await db.query<SessionRow>(
        `UPDATE session_requests SET status = 'ended', ended_at = now(), ended_by = 'parent'
         WHERE id = $1 RETURNING *`,
        [session.id],
      );
      const out = toSession(updated[0]);
      const devices = await db.query<DeviceRow>('SELECT * FROM devices WHERE id = $1', [session.device_id]);
      const device = devices[0];
      await writeAudit(db, {
        familyId: session.family_id,
        deviceId: session.device_id,
        sessionId: session.id,
        actorType: 'parent',
        actorId: req.user!.id,
        action: 'session.ended',
        metadata: { by: 'parent', reason: body.reason ?? '' },
      });
      await recordEvent(db, hub, {
        familyId: session.family_id,
        deviceId: session.device_id,
        kind: 'session.ended',
        severity: 'info',
        title: `${SESSION_LABELS[session.kind]} ended`,
        detail: `${device?.name ?? 'Child device'} session ended by ${req.user!.display_name}`,
        metadata: { sessionId: session.id, by: 'parent' },
      });
      hub.sendToDevice(session.device_id, { type: 'session.update', data: { session: out } });
      hub.sendToUser(req.user!.id, { type: 'session.update', data: { session: out } });
      res.json({ session: out });
    }),
  );

  return r;
}
