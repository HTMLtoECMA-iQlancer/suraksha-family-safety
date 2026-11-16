import { randomUUID } from 'node:crypto';
import type { AuthTokens } from '@suraksha/shared';
import type { Db } from './db.js';
import { randomToken, sha256, signAccessToken } from './crypto.js';
import { env } from '../config.js';
import type { DeviceRow, UserRow } from './models.js';
import { ApiError } from './http.js';

interface RefreshRow {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
}

interface DeviceTokenRow {
  id: string;
  device_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export async function issueUserTokens(db: Db, user: UserRow, userAgent?: string): Promise<AuthTokens> {
  const refreshToken = randomToken(48);
  const refreshExpiresAt = isoIn(env.refreshTtlDays * 24 * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), user.id, sha256(refreshToken), randomUUID(), userAgent ?? null, refreshExpiresAt],
  );
  const accessToken = await signAccessToken({ sub: user.id, typ: 'user', name: user.display_name });
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: isoIn(env.accessTtlSeconds * 1000),
    refreshExpiresAt,
  };
}

export async function rotateUserRefresh(db: Db, refreshToken: string, userAgent?: string): Promise<{ user: UserRow; tokens: AuthTokens }> {
  const hash = sha256(refreshToken);
  return db.transaction(async (tx) => {
    const rows = await tx.query<RefreshRow>('SELECT * FROM refresh_tokens WHERE token_hash = $1', [hash]);
    const row = rows[0];
    if (!row) throw new ApiError(401, 'invalid_refresh', 'Please sign in again');
    if (row.revoked_at) {
      await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
      throw new ApiError(401, 'refresh_reused', 'Session was already rotated. Please sign in again.');
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new ApiError(401, 'refresh_expired', 'Your session expired. Please sign in again.');
    }
    const users = await tx.query<UserRow>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [row.user_id]);
    if (!users.length) throw new ApiError(401, 'account_inactive', 'This account is not active');
    const user = users[0];

    const newToken = randomToken(48);
    const newId = randomUUID();
    const refreshExpiresAt = isoIn(env.refreshTtlDays * 24 * 60 * 60 * 1000);
    await tx.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $1 WHERE id = $2', [newId, row.id]);
    await tx.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId, user.id, sha256(newToken), row.family_id, userAgent ?? null, refreshExpiresAt],
    );
    const accessToken = await signAccessToken({ sub: user.id, typ: 'user', name: user.display_name });
    return {
      user,
      tokens: {
        accessToken,
        refreshToken: newToken,
        accessExpiresAt: isoIn(env.accessTtlSeconds * 1000),
        refreshExpiresAt,
      },
    };
  });
}

export async function revokeUserRefresh(db: Db, refreshToken: string): Promise<void> {
  const rows = await db.query<RefreshRow>('SELECT * FROM refresh_tokens WHERE token_hash = $1', [sha256(refreshToken)]);
  if (!rows.length) return;
  await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [rows[0].family_id]);
}

export async function revokeAllUserTokens(db: Db, userId: string): Promise<void> {
  await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

export async function issueDeviceTokens(db: Db, device: DeviceRow): Promise<AuthTokens> {
  const refreshToken = randomToken(48);
  const expiresAt = isoIn(env.deviceRefreshTtlDays * 24 * 60 * 60 * 1000);
  await db.query(
    'INSERT INTO device_tokens (id, device_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [randomUUID(), device.id, sha256(refreshToken), expiresAt],
  );
  const accessToken = await signAccessToken(
    { sub: device.id, typ: 'device', fid: device.family_id, name: device.name },
    60 * 60,
  );
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: isoIn(60 * 60 * 1000),
    refreshExpiresAt: expiresAt,
  };
}

export async function rotateDeviceRefresh(db: Db, refreshToken: string): Promise<{ device: DeviceRow; tokens: AuthTokens }> {
  const rows = await db.query<DeviceTokenRow>('SELECT * FROM device_tokens WHERE token_hash = $1', [sha256(refreshToken)]);
  const row = rows[0];
  if (!row) throw new ApiError(401, 'invalid_refresh', 'Device session is no longer valid');
  if (row.revoked_at) throw new ApiError(401, 'refresh_reused', 'Device session is no longer valid');
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new ApiError(401, 'refresh_expired', 'Device session expired');
  const devices = await db.query<DeviceRow>('SELECT * FROM devices WHERE id = $1 AND unlinked_at IS NULL', [row.device_id]);
  if (!devices.length) throw new ApiError(401, 'device_unlinked', 'This device was unlinked');
  await db.query('UPDATE device_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
  return { device: devices[0], tokens: await issueDeviceTokens(db, devices[0]) };
}

export async function revokeDeviceTokens(db: Db, deviceId: string): Promise<void> {
  await db.query('UPDATE device_tokens SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL', [deviceId]);
}
