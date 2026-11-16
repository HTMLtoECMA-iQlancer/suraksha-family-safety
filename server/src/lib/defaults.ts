import { randomUUID } from 'node:crypto';
import { ANDROID_PERMISSIONS, type PolicyMap, type PolicyKind, type PermissionState } from '@suraksha/shared';
import type { Db } from './db.js';
import { parseJson } from './models.js';

export function defaultPermissions(): PermissionState[] {
  return ANDROID_PERMISSIONS.map((p) => ({
    key: p.key,
    label: p.label,
    granted: false,
    requiredFor: p.requiredFor,
    updatedAt: null,
  }));
}

export function defaultPolicies(): PolicyMap {
  return {
    screen_time: {
      dailyLimitMinutes: 180,
      downtime: { enabled: true, start: '21:00', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6] },
      week: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, limitMinutes: 180 })),
    },
    app_rules: { rules: [] },
    location: {
      sharingEnabled: true,
      historyEnabled: true,
      retentionDays: 30,
      drivingAlerts: true,
      sosEnabled: true,
    },
    safe_browsing: {
      enabled: false,
      method: 'dns',
      blockedCategories: ['adult', 'gambling', 'violence'],
      allowList: [],
    },
    notifications: {
      safetyAlerts: true,
      sessionRequests: true,
      dailyDigest: true,
      quietHours: { enabled: false, start: '22:00', end: '07:00' },
    },
    supervision: {
      requireApprovalAlways: true,
      childCanStopSessions: true,
      shareSessionHistoryWithChild: true,
    },
    instant_block: { active: false, until: null },
  };
}

const KINDS = Object.keys(defaultPolicies()) as PolicyKind[];

export async function ensurePolicies(db: Db, familyId: string, deviceId: string, updatedBy: string | null): Promise<void> {
  const defaults = defaultPolicies();
  for (const kind of KINDS) {
    await db.query(
      `INSERT INTO policies (id, family_id, device_id, kind, payload, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (device_id, kind) DO NOTHING`,
      [randomUUID(), familyId, deviceId, kind, JSON.stringify(defaults[kind]), updatedBy],
    );
  }
}

export async function getPolicies(db: Db, deviceId: string): Promise<PolicyMap> {
  const merged = defaultPolicies();
  const rows = await db.query<{ kind: PolicyKind; payload: unknown; enabled: boolean }>(
    'SELECT kind, payload, enabled FROM policies WHERE device_id = $1',
    [deviceId],
  );
  for (const row of rows) {
    if (row.kind in merged && row.enabled) {
      const target = merged as unknown as Record<string, Record<string, unknown>>;
      target[row.kind] = {
        ...target[row.kind],
        ...parseJson<Record<string, unknown>>(row.payload, {}),
      };
    }
  }
  if (merged.instant_block.active && merged.instant_block.until) {
    if (new Date(merged.instant_block.until).getTime() <= Date.now()) {
      merged.instant_block = { active: false, until: null };
    }
  }
  return merged;
}

export async function upsertPolicy(
  db: Db,
  familyId: string,
  deviceId: string,
  kind: PolicyKind,
  payload: unknown,
  updatedBy: string,
): Promise<void> {
  await db.query(
    `INSERT INTO policies (id, family_id, device_id, kind, payload, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (device_id, kind)
     DO UPDATE SET payload = $5, updated_by = $6, updated_at = now()`,
    [randomUUID(), familyId, deviceId, kind, JSON.stringify(payload), updatedBy],
  );
}
