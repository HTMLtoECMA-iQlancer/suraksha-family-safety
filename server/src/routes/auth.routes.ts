import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Family } from '@suraksha/shared';
import type { Db } from '../lib/db.js';
import { ah, ApiError, conflict, rateLimit, unauthorized, validate } from '../lib/http.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { issueUserTokens, revokeAllUserTokens, revokeUserRefresh, rotateUserRefresh } from '../lib/tokens.js';
import { toUser } from '../lib/models.js';
import type { UserRow } from '../lib/models.js';
import { requireUser } from '../lib/auth.js';
import {
  changePasswordSchema,
  deleteAccountSchema,
  loginSchema,
  pushTokenSchema,
  refreshSchema,
  registerSchema,
  updateMeSchema,
} from '../lib/schemas.js';

interface FamilyJoinRow {
  id: string;
  name: string;
  role: Family['role'];
  created_at: string;
}

async function familiesFor(db: Db, userId: string): Promise<Family[]> {
  const rows = await db.query<FamilyJoinRow>(
    `SELECT f.id, f.name, m.role, f.created_at
     FROM families f
     JOIN family_members m ON m.family_id = f.id
     WHERE m.user_id = $1 AND m.status = 'active'
     ORDER BY f.created_at ASC`,
    [userId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, role: r.role, createdAt: r.created_at }));
}

async function authPayload(db: Db, user: UserRow) {
  return { user: toUser(user), families: await familiesFor(db, user.id) };
}

export function authRoutes(db: Db): Router {
  const r = Router();
  const authLimit = rateLimit({ name: 'auth', windowMs: 60_000, max: 20 });

  r.post(
    '/auth/register',
    authLimit,
    validate(registerSchema),
    ah(async (req, res) => {
      const body = req.body as typeof registerSchema._type;
      const existing = await db.query('SELECT id FROM users WHERE email = $1', [body.email]);
      if (existing.length) throw conflict('An account with this email already exists');
      const userId = randomUUID();
      const familyId = randomUUID();
      const memberId = randomUUID();
      const passwordHash = await hashPassword(body.password);
      await db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO users (id, email, phone, password_hash, display_name, locale, email_verified)
           VALUES ($1, $2, $3, $4, $5, $6, false)`,
          [userId, body.email, body.phone ?? null, passwordHash, body.displayName, body.locale],
        );
        await tx.query('INSERT INTO families (id, name, created_by) VALUES ($1, $2, $3)', [
          familyId,
          'My family',
          userId,
        ]);
        await tx.query(
          `INSERT INTO family_members (id, family_id, user_id, email, display_name, role, status, accepted_at)
           VALUES ($1, $2, $3, $4, $5, 'owner', 'active', now())`,
          [memberId, familyId, userId, body.email, body.displayName],
        );
        await tx.query(
          `INSERT INTO consent_records (id, family_id, user_id, kind, text_version, granted)
           VALUES ($1, $2, $3, 'terms_privacy', '2026-11-01', true)`,
          [randomUUID(), familyId, userId],
        );
        if (body.acceptTerms) {
          await tx.query(
            `INSERT INTO consent_records (id, family_id, user_id, kind, text_version, granted)
             VALUES ($1, $2, $3, 'explicit_terms', '2026-11-01', true)`,
            [randomUUID(), familyId, userId],
          );
        }
      });
      const users = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
      const tokens = await issueUserTokens(db, users[0], req.get('user-agent') ?? undefined);
      const payload = await authPayload(db, users[0]);
      res.status(201).json({ ...payload, tokens });
    }),
  );

  r.post(
    '/auth/login',
    authLimit,
    validate(loginSchema),
    ah(async (req, res) => {
      const body = req.body as typeof loginSchema._type;
      const rows = await db.query<UserRow>('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [body.email]);
      if (!rows.length) {
        await hashPassword(body.password);
        throw unauthorized('Email or password is incorrect');
      }
      const ok = await verifyPassword(body.password, rows[0].password_hash);
      if (!ok) throw unauthorized('Email or password is incorrect');
      const tokens = await issueUserTokens(db, rows[0], req.get('user-agent') ?? undefined);
      const payload = await authPayload(db, rows[0]);
      res.json({ ...payload, tokens });
    }),
  );

  r.post(
    '/auth/refresh',
    validate(refreshSchema),
    ah(async (req, res) => {
      const body = req.body as typeof refreshSchema._type;
      const { user, tokens } = await rotateUserRefresh(db, body.refreshToken, req.get('user-agent') ?? undefined);
      const payload = await authPayload(db, user);
      res.json({ ...payload, tokens });
    }),
  );

  r.post(
    '/auth/logout',
    validate(refreshSchema),
    ah(async (req, res) => {
      const body = req.body as typeof refreshSchema._type;
      await revokeUserRefresh(db, body.refreshToken);
      res.status(204).end();
    }),
  );

  r.get(
    '/me',
    requireUser(db),
    ah(async (req, res) => {
      res.json(await authPayload(db, req.user!));
    }),
  );

  r.patch(
    '/me',
    requireUser(db),
    validate(updateMeSchema),
    ah(async (req, res) => {
      const body = req.body as typeof updateMeSchema._type;
      const sets: string[] = [];
      const params: unknown[] = [];
      if (body.displayName !== undefined) {
        params.push(body.displayName);
        sets.push(`display_name = $${params.length}`);
      }
      if (body.phone !== undefined) {
        params.push(body.phone);
        sets.push(`phone = $${params.length}`);
      }
      if (body.locale !== undefined) {
        params.push(body.locale);
        sets.push(`locale = $${params.length}`);
      }
      if (!sets.length) {
        res.json(await authPayload(db, req.user!));
        return;
      }
      params.push(req.user!.id);
      await db.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
      const users = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [req.user!.id]);
      res.json(await authPayload(db, users[0]));
    }),
  );

  r.post(
    '/me/password',
    requireUser(db),
    validate(changePasswordSchema),
    ah(async (req, res) => {
      const body = req.body as typeof changePasswordSchema._type;
      const ok = await verifyPassword(body.currentPassword, req.user!.password_hash);
      if (!ok) throw new ApiError(400, 'wrong_password', 'Current password is incorrect');
      const hash = await hashPassword(body.newPassword);
      await db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, req.user!.id]);
      await revokeAllUserTokens(db, req.user!.id);
      const users = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [req.user!.id]);
      const tokens = await issueUserTokens(db, users[0], req.get('user-agent') ?? undefined);
      res.json({ tokens });
    }),
  );

  r.post(
    '/me/push-token',
    requireUser(db),
    validate(pushTokenSchema),
    ah(async (req, res) => {
      const body = req.body as typeof pushTokenSchema._type;
      await db.query(
        `INSERT INTO push_tokens (id, user_id, token, platform)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (token) DO UPDATE SET user_id = $2, device_id = NULL, platform = $4, updated_at = now()`,
        [randomUUID(), req.user!.id, body.token, body.platform],
      );
      res.status(204).end();
    }),
  );

  r.get(
    '/me/export',
    requireUser(db),
    ah(async (req, res) => {
      const families = await familiesFor(db, req.user!.id);
      const familyIds = families.map((f) => f.id);
      const exportData: Record<string, unknown> = {
        exportedAt: new Date().toISOString(),
        account: toUser(req.user!),
        families,
        members: [],
        devices: [],
        policies: [],
        consents: [],
        usage: [],
        events: [],
        locations: [],
        sessions: [],
        audit: [],
      };
      if (familyIds.length) {
        const placeholders = familyIds.map((_, i) => `$${i + 1}`).join(',');
        exportData.members = await db.query(
          `SELECT family_id, email, display_name, role, status, created_at, accepted_at
           FROM family_members WHERE family_id IN (${placeholders})`,
          familyIds,
        );
        exportData.devices = await db.query(
          `SELECT id, family_id, child_name, name, model, platform, os_version, app_version, status, battery,
                  network, last_seen_at, permission_status, linked_at, created_at
           FROM devices WHERE family_id IN (${placeholders})`,
          familyIds,
        );
        exportData.policies = await db.query(
          `SELECT device_id, kind, payload, updated_at FROM policies WHERE family_id IN (${placeholders})`,
          familyIds,
        );
        exportData.consents = await db.query(
          `SELECT device_id, kind, text_version, granted, created_at FROM consent_records WHERE family_id IN (${placeholders})`,
          familyIds,
        );
        exportData.usage = await db.query(
          `SELECT device_id, day, package, app_name, category, minutes FROM app_usage_daily
           WHERE family_id IN (${placeholders}) AND day >= now() - interval '90 days'`,
          familyIds,
        );
        exportData.events = await db.query(
          `SELECT device_id, kind, severity, title, detail, metadata, occurred_at FROM safety_events
           WHERE family_id IN (${placeholders}) ORDER BY occurred_at DESC LIMIT 500`,
          familyIds,
        );
        exportData.locations = await db.query(
          `SELECT device_id, lat, lng, accuracy, speed, recorded_at FROM locations
           WHERE family_id IN (${placeholders}) ORDER BY recorded_at DESC LIMIT 500`,
          familyIds,
        );
        exportData.sessions = await db.query(
          `SELECT device_id, parent_user_id, kind, status, reason, created_at, responded_at, started_at, ended_at, ended_by
           FROM session_requests WHERE family_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 200`,
          familyIds,
        );
        exportData.audit = await db.query(
          `SELECT device_id, session_id, actor_type, action, metadata, created_at FROM audit_logs
           WHERE family_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 500`,
          familyIds,
        );
      }
      res.setHeader('Content-Disposition', `attachment; filename="suraksha-export-${Date.now()}.json"`);
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(exportData, null, 2));
    }),
  );

  r.delete(
    '/me',
    requireUser(db),
    validate(deleteAccountSchema),
    ah(async (req, res) => {
      const body = req.body as typeof deleteAccountSchema._type;
      const ok = await verifyPassword(body.password, req.user!.password_hash);
      if (!ok) throw new ApiError(400, 'wrong_password', 'Password is incorrect');
      const userId = req.user!.id;
      await db.transaction(async (tx) => {
        const owned = await tx.query<{ id: string }>('SELECT id FROM families WHERE created_by = $1', [userId]);
        for (const family of owned) {
          const others = await tx.query<{ id: string; user_id: string }>(
            `SELECT id, user_id FROM family_members
             WHERE family_id = $1 AND status = 'active' AND user_id IS NOT NULL AND user_id <> $2
               AND role IN ('parent', 'owner')
             ORDER BY created_at ASC LIMIT 1`,
            [family.id, userId],
          );
          if (others.length) {
            await tx.query("UPDATE family_members SET role = 'owner' WHERE id = $1", [others[0].id]);
            await tx.query('UPDATE families SET created_by = $1 WHERE id = $2', [others[0].user_id, family.id]);
          } else {
            await tx.query('DELETE FROM families WHERE id = $1', [family.id]);
          }
        }
        await tx.query("UPDATE family_members SET status = 'revoked', user_id = NULL WHERE user_id = $1", [userId]);
        await tx.query('DELETE FROM push_tokens WHERE user_id = $1', [userId]);
        await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
        await tx.query(
          `UPDATE users SET email = $1, phone = NULL, password_hash = $2, display_name = 'Deleted account',
             deleted_at = now(), updated_at = now() WHERE id = $3`,
          [`deleted+${userId}@invalid.local`, await hashPassword(randomUUID()), userId],
        );
      });
      res.status(204).end();
    }),
  );

  return r;
}
