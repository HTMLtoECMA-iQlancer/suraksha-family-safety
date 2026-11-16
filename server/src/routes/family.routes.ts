import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Db } from '../lib/db.js';
import { ah, conflict, forbidden, notFound, rateLimit, validate } from '../lib/http.js';
import { requireUser, assertFamilyAccess } from '../lib/auth.js';
import { generateCode, inviteCodeHash } from '../lib/crypto.js';
import { toAudit, toDevice, toMember } from '../lib/models.js';
import type { AuditRow, DeviceRow, MemberRow } from '../lib/models.js';
import { writeAudit } from '../lib/events.js';
import { acceptInviteSchema, createFamilySchema, inviteSchema, roleSchema } from '../lib/schemas.js';
import type { Hub } from '../realtime.js';

export function familyRoutes(db: Db, hub: Hub): Router {
  const r = Router();

  r.get(
    '/families',
    requireUser(db),
    ah(async (req, res) => {
      const rows = await db.query(
        `SELECT f.id, f.name, m.role, f.created_at,
           (SELECT count(*) FROM family_members x WHERE x.family_id = f.id AND x.status = 'active')::int AS member_count,
           (SELECT count(*) FROM devices d WHERE d.family_id = f.id AND d.unlinked_at IS NULL)::int AS device_count
         FROM families f
         JOIN family_members m ON m.family_id = f.id
         WHERE m.user_id = $1 AND m.status = 'active'
         ORDER BY f.created_at ASC`,
        [req.user!.id],
      );
      res.json({
        families: rows.map((f) => ({
          id: f.id,
          name: f.name,
          role: f.role,
          createdAt: f.created_at,
          memberCount: f.member_count,
          deviceCount: f.device_count,
        })),
      });
    }),
  );

  r.post(
    '/families',
    requireUser(db),
    validate(createFamilySchema),
    ah(async (req, res) => {
      const familyId = randomUUID();
      await db.transaction(async (tx) => {
        await tx.query('INSERT INTO families (id, name, created_by) VALUES ($1, $2, $3)', [
          familyId,
          req.body.name,
          req.user!.id,
        ]);
        await tx.query(
          `INSERT INTO family_members (id, family_id, user_id, email, display_name, role, status, accepted_at)
           VALUES ($1, $2, $3, $4, $5, 'owner', 'active', now())`,
          [randomUUID(), familyId, req.user!.id, req.user!.email, req.user!.display_name],
        );
      });
      hub.sendToUser(req.user!.id, { type: 'family.changed', data: { familyId } });
      res.status(201).json({ family: { id: familyId, name: req.body.name, role: 'owner', createdAt: new Date().toISOString() } });
    }),
  );

  r.get(
    '/families/:id/members',
    requireUser(db),
    ah(async (req, res) => {
      await assertFamilyAccess(db, req.user!.id, req.params.id, 'read');
      const rows = await db.query<MemberRow>(
        `SELECT * FROM family_members WHERE family_id = $1 AND status <> 'revoked' ORDER BY created_at ASC`,
        [req.params.id],
      );
      res.json({ members: rows.map(toMember) });
    }),
  );

  r.post(
    '/families/:id/invites',
    requireUser(db),
    rateLimit({ name: 'invite', windowMs: 60_000, max: 20 }),
    validate(inviteSchema),
    ah(async (req, res) => {
      const member = await assertFamilyAccess(db, req.user!.id, req.params.id, 'write');
      const body = req.body as typeof inviteSchema._type;
      if (body.role === 'parent' && member.role !== 'owner') {
        throw forbidden('Only the family owner can invite another parent');
      }
      const existing = await db.query<MemberRow>(
        'SELECT * FROM family_members WHERE family_id = $1 AND lower(email) = lower($2)',
        [req.params.id, body.email],
      );
      if (existing.length && existing[0].status === 'active') throw conflict('This person is already in the family');
      const code = generateCode(8);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      if (existing.length) {
        const row = existing[0];
        await db.query(
          `UPDATE family_members SET role = $1, invite_code_hash = $2, invite_expires_at = $3, status = 'invited',
             display_name = $4, invited_by = $5 WHERE id = $6`,
          [body.role, inviteCodeHash(code), expiresAt, body.displayName ?? body.email.split('@')[0], req.user!.id, row.id],
        );
      } else {
        await db.query(
          `INSERT INTO family_members (id, family_id, email, display_name, role, status, invite_code_hash, invite_expires_at, invited_by)
           VALUES ($1, $2, $3, $4, $5, 'invited', $6, $7, $8)`,
          [
            randomUUID(),
            req.params.id,
            body.email,
            body.displayName ?? body.email.split('@')[0],
            body.role,
            inviteCodeHash(code),
            expiresAt,
            req.user!.id,
          ],
        );
      }
      await writeAudit(db, {
        familyId: req.params.id,
        actorType: 'parent',
        actorId: req.user!.id,
        action: 'family.invite_created',
        metadata: { email: body.email, role: body.role },
      });
      res.status(201).json({ invite: { email: body.email, role: body.role, code, expiresAt } });
    }),
  );

  r.post(
    '/invites/accept',
    requireUser(db),
    rateLimit({ name: 'invite-accept', windowMs: 60_000, max: 20 }),
    validate(acceptInviteSchema),
    ah(async (req, res) => {
      const rows = await db.query<MemberRow>('SELECT * FROM family_members WHERE invite_code_hash = $1 LIMIT 1', [
        inviteCodeHash(req.body.code),
      ]);
      const invite = rows[0];
      if (!invite || invite.status !== 'invited') throw notFound('This invite code is no longer valid');
      if (invite.invite_expires_at && new Date(invite.invite_expires_at).getTime() <= Date.now()) {
        throw conflict('This invite has expired. Ask the family owner for a new code.');
      }
      if (invite.email.toLowerCase() !== req.user!.email.toLowerCase()) {
        throw forbidden('This invite was issued to a different email address');
      }
      await db.query(
        `UPDATE family_members SET user_id = $1, status = 'active', accepted_at = now(), invite_code_hash = NULL WHERE id = $2`,
        [req.user!.id, invite.id],
      );
      const family = await db.query<{ id: string; name: string }>('SELECT id, name FROM families WHERE id = $1', [
        invite.family_id,
      ]);
      await writeAudit(db, {
        familyId: invite.family_id,
        actorType: 'parent',
        actorId: req.user!.id,
        action: 'family.invite_accepted',
        metadata: { role: invite.role },
      });
      hub.broadcastToFamily(invite.family_id, { type: 'family.changed', data: { familyId: invite.family_id } });
      res.json({
        family: {
          id: invite.family_id,
          name: family[0]?.name ?? 'Family',
          role: invite.role,
          createdAt: new Date().toISOString(),
        },
      });
    }),
  );

  r.patch(
    '/families/:id/members/:memberId',
    requireUser(db),
    validate(roleSchema),
    ah(async (req, res) => {
      const actor = await assertFamilyAccess(db, req.user!.id, req.params.id, 'manage');
      const rows = await db.query<MemberRow>('SELECT * FROM family_members WHERE id = $1 AND family_id = $2', [
        req.params.memberId,
        req.params.id,
      ]);
      const target = rows[0];
      if (!target) throw notFound('Family member not found');
      if (target.role === 'owner') throw forbidden('The family owner role cannot be changed');
      if (target.status !== 'active') throw conflict('Member is not active');
      await db.query('UPDATE family_members SET role = $1 WHERE id = $2', [req.body.role, target.id]);
      await writeAudit(db, {
        familyId: req.params.id,
        actorType: 'parent',
        actorId: actor.user_id,
        action: 'family.role_changed',
        metadata: { memberId: target.id, role: req.body.role },
      });
      hub.broadcastToFamily(req.params.id, { type: 'family.changed', data: { familyId: req.params.id } });
      res.json({ member: { ...toMember(target), role: req.body.role } });
    }),
  );

  r.delete(
    '/families/:id/members/:memberId',
    requireUser(db),
    ah(async (req, res) => {
      const rows = await db.query<MemberRow>('SELECT * FROM family_members WHERE id = $1 AND family_id = $2', [
        req.params.memberId,
        req.params.id,
      ]);
      const target = rows[0];
      if (!target) throw notFound('Family member not found');
      const isSelf = target.user_id === req.user!.id;
      if (!isSelf) await assertFamilyAccess(db, req.user!.id, req.params.id, 'manage');
      if (target.role === 'owner') throw forbidden('The family owner cannot be removed. Transfer ownership first.');
      await db.query("UPDATE family_members SET status = 'revoked', user_id = NULL WHERE id = $1", [target.id]);
      await writeAudit(db, {
        familyId: req.params.id,
        actorType: isSelf ? 'parent' : 'parent',
        actorId: req.user!.id,
        action: isSelf ? 'family.member_left' : 'family.member_removed',
        metadata: { memberId: target.id, email: target.email },
      });
      hub.broadcastToFamily(req.params.id, { type: 'family.changed', data: { familyId: req.params.id } });
      res.status(204).end();
    }),
  );

  r.get(
    '/families/:id/devices',
    requireUser(db),
    ah(async (req, res) => {
      await assertFamilyAccess(db, req.user!.id, req.params.id, 'read');
      const devices = await db.query<DeviceRow>('SELECT * FROM devices WHERE family_id = $1 AND unlinked_at IS NULL ORDER BY created_at ASC', [
        req.params.id,
      ]);
      res.json({ devices: devices.map((d) => toDevice(d, hub.isDeviceOnline(d.id))) });
    }),
  );

  r.get(
    '/families/:id/access',
    requireUser(db),
    ah(async (req, res) => {
      await assertFamilyAccess(db, req.user!.id, req.params.id, 'read');
      const members = await db.query<MemberRow>(
        `SELECT * FROM family_members WHERE family_id = $1 AND status = 'active' ORDER BY role DESC, created_at ASC`,
        [req.params.id],
      );
      const devices = await db.query<{ id: string; name: string; child_name: string }>(
        'SELECT id, name, child_name FROM devices WHERE family_id = $1 AND unlinked_at IS NULL',
        [req.params.id],
      );
      res.json({
        devices: devices.map((d) => ({ id: d.id, name: d.name, childName: d.child_name })),
        caregivers: members.map((m) => ({
          memberId: m.id,
          userId: m.user_id,
          displayName: m.display_name,
          role: m.role,
          canViewDevices: true,
          canManageDevices: m.role === 'owner' || m.role === 'parent',
          canStartSessions: m.role === 'owner' || m.role === 'parent' || m.role === 'caregiver',
          deviceIds: devices.map((d) => d.id),
        })),
      });
    }),
  );

  r.get(
    '/families/:id/audit',
    requireUser(db),
    ah(async (req, res) => {
      await assertFamilyAccess(db, req.user!.id, req.params.id, 'read');
      const rows = await db.query<AuditRow>(
        `SELECT id, family_id, device_id, session_id, actor_type, actor_id, action, metadata, created_at
         FROM audit_logs WHERE family_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [req.params.id],
      );
      res.json({ audit: rows.map(toAudit) });
    }),
  );

  return r;
}
