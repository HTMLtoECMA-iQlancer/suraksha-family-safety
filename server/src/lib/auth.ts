import type { RequestHandler } from 'express';
import type { Db } from './db.js';
import { ApiError, bearerToken, forbidden, unauthorized } from './http.js';
import { verifyAccessToken } from './crypto.js';
import type { DeviceRow, MemberRow, UserRow } from './models.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
      device?: DeviceRow;
      membership?: MemberRow;
      authKind?: 'user' | 'device';
    }
  }
}

export function requireUser(db: Db): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      const token = bearerToken(req);
      if (!token) throw unauthorized();
      const payload = await verifyAccessToken(token);
      if (!payload || payload.typ !== 'user') throw unauthorized('Your session has expired. Please sign in again.');
      const rows = await db.query<UserRow>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [payload.sub]);
      if (!rows.length) throw unauthorized('This account is no longer active.');
      req.user = rows[0];
      req.authKind = 'user';
      next();
    })().catch(next);
  };
}

export function requireDevice(db: Db): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      const token = bearerToken(req);
      if (!token) throw unauthorized();
      const payload = await verifyAccessToken(token);
      if (!payload || payload.typ !== 'device') throw unauthorized('Device session expired');
      const rows = await db.query<DeviceRow>(
        'SELECT * FROM devices WHERE id = $1 AND unlinked_at IS NULL',
        [payload.sub],
      );
      if (!rows.length) throw new ApiError(401, 'device_unlinked', 'This device has been unlinked by the family');
      req.device = rows[0];
      req.authKind = 'device';
      next();
    })().catch(next);
  };
}

/** Applied to routers mounted on a shared /api prefix, so device-token routes can pass through. */
export function skipPath(prefix: string, handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (req.path === prefix || req.path.startsWith(`${prefix}/`)) {
      next();
      return;
    }
    handler(req, res, next);
  };
}

export type AccessLevel = 'read' | 'write' | 'manage';

const levelRank: Record<AccessLevel, number> = { read: 0, write: 1, manage: 2 };
const roleRank: Record<string, number> = { caregiver: 0, parent: 1, owner: 2 };

export async function membershipFor(db: Db, userId: string, familyId: string): Promise<MemberRow | null> {
  const rows = await db.query<MemberRow>(
    "SELECT * FROM family_members WHERE family_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1",
    [familyId, userId],
  );
  return rows[0] ?? null;
}

export async function assertFamilyAccess(
  db: Db,
  userId: string,
  familyId: string,
  level: AccessLevel = 'read',
): Promise<MemberRow> {
  const member = await membershipFor(db, userId, familyId);
  if (!member) throw forbidden('You are not a member of this family');
  if (roleRank[member.role] < levelRank[level]) throw forbidden('Your caregiver role does not allow this action');
  return member;
}

export async function accessibleDevice(
  db: Db,
  userId: string,
  deviceId: string,
  level: AccessLevel = 'read',
): Promise<{ device: DeviceRow; member: MemberRow }> {
  const rows = await db.query<DeviceRow>(
    'SELECT * FROM devices WHERE id = $1 AND unlinked_at IS NULL',
    [deviceId],
  );
  if (!rows.length) throw new ApiError(404, 'not_found', 'Device not found');
  const device = rows[0];
  const member = await assertFamilyAccess(db, userId, device.family_id, level);
  return { device, member };
}

export async function familyIdsForUser(db: Db, userId: string): Promise<string[]> {
  const rows = await db.query<{ family_id: string }>(
    "SELECT family_id FROM family_members WHERE user_id = $1 AND status = 'active'",
    [userId],
  );
  return rows.map((r) => r.family_id);
}
