import type {
  AuditLog,
  Device,
  FamilyMember,
  Geofence,
  LocationPoint,
  SafetyEvent,
  SessionRequest,
  User,
  UserRole,
  UsageDay,
  PermissionState,
  TrustedCheckIn,
} from '@suraksha/shared';

export interface UserRow {
  id: string;
  email: string;
  phone: string | null;
  password_hash: string;
  display_name: string;
  locale: 'en' | 'gu';
  email_verified: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface FamilyRow {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}

export interface MemberRow {
  id: string;
  family_id: string;
  user_id: string | null;
  email: string;
  display_name: string;
  role: UserRole;
  status: 'active' | 'invited' | 'revoked';
  invite_code_hash: string | null;
  invite_expires_at: string | null;
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
}

export interface DeviceRow {
  id: string;
  family_id: string;
  child_name: string;
  name: string;
  model: string;
  platform: 'android' | 'web-preview' | 'ios-preview';
  os_version: string;
  app_version: string;
  status: 'online' | 'offline';
  battery: number | null;
  network: string | null;
  last_seen_at: string | null;
  permission_status: PermissionState[] | string;
  trusted_check_in: TrustedCheckIn | string | null;
  linked_at: string | null;
  unlinked_at: string | null;
  created_at: string;
}

export interface SessionRow {
  id: string;
  family_id: string;
  device_id: string;
  parent_user_id: string;
  parent_name: string;
  kind: 'camera' | 'audio' | 'screen';
  status: SessionRequest['status'];
  reason: string;
  trusted: boolean;
  created_at: string;
  responded_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  ended_by: 'parent' | 'child' | 'system' | null;
}

export interface EventRow {
  id: string;
  family_id: string;
  device_id: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  metadata: Record<string, unknown> | string;
  occurred_at: string;
  created_at: string;
}

export interface LocationRow {
  id: string;
  family_id: string;
  device_id: string;
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  recorded_at: string;
}

export interface GeofenceRow {
  id: string;
  family_id: string;
  device_id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  notify_on_enter: boolean;
  notify_on_exit: boolean;
  enabled: boolean;
  created_at: string;
}

export interface UsageRow {
  device_id: string;
  day: string;
  package: string;
  app_name: string;
  category: string;
  minutes: number;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    displayName: row.display_name,
    locale: row.locale,
    emailVerified: row.email_verified,
    createdAt: row.created_at,
  };
}

export function toMember(row: MemberRow): FamilyMember {
  return {
    id: row.id,
    familyId: row.family_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  };
}

export function toDevice(row: DeviceRow, online?: boolean): Device {
  const permissions = parseJson<PermissionState[]>(row.permission_status, []);
  const granted = permissions.filter((p) => p.granted).length;
  const isOnline = online ?? row.status === 'online';
  return {
    id: row.id,
    familyId: row.family_id,
    childName: row.child_name,
    name: row.name,
    model: row.model,
    platform: row.platform,
    osVersion: row.os_version,
    appVersion: row.app_version,
    status: isOnline ? 'online' : 'offline',
    online: isOnline,
    battery: row.battery,
    network: row.network,
    lastSeenAt: row.last_seen_at,
    linkedAt: row.linked_at,
    createdAt: row.created_at,
    permissions,
    permissionHealth: permissions.length ? Math.round((granted / permissions.length) * 100) : 0,
    trustedCheckIn: parseJson<TrustedCheckIn>(row.trusted_check_in, {
      enabled: false,
      kinds: [],
      updatedAt: null,
    }),
  };
}

export function toSession(row: SessionRow): SessionRequest {
  return {
    id: row.id,
    familyId: row.family_id,
    deviceId: row.device_id,
    parentUserId: row.parent_user_id,
    parentName: row.parent_name,
    kind: row.kind,
    status: row.status,
    reason: row.reason,
    trusted: row.trusted === true,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    endedBy: row.ended_by,
  };
}

export function toEvent(row: EventRow): SafetyEvent {
  return {
    id: row.id,
    familyId: row.family_id,
    deviceId: row.device_id,
    kind: row.kind as SafetyEvent['kind'],
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

export function toLocation(row: LocationRow): LocationPoint {
  return {
    id: row.id,
    deviceId: row.device_id,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    speed: row.speed,
    recordedAt: row.recorded_at,
  };
}

export function toGeofence(row: GeofenceRow): Geofence {
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

export interface AuditRow {
  id: string;
  family_id: string;
  device_id: string | null;
  session_id: string | null;
  actor_type: AuditLog['actorType'];
  actor_id: string | null;
  action: string;
  metadata: unknown;
  created_at: string;
}

export function toAudit(row: AuditRow): AuditLog {
  return {
    id: row.id,
    familyId: row.family_id,
    deviceId: row.device_id,
    sessionId: row.session_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.created_at,
  };
}

export function groupUsage(rows: UsageRow[]): UsageDay[] {
  const days = new Map<string, UsageRow[]>();
  for (const row of rows) {
    const key = String(row.day).slice(0, 10);
    const list = days.get(key) ?? [];
    list.push(row);
    days.set(key, list);
  }
  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, entries]) => ({
      day,
      entries: entries
        .map((e) => ({
          package: e.package,
          appName: e.app_name,
          category: e.category,
          minutes: Number(e.minutes),
        }))
        .sort((a, b) => b.minutes - a.minutes),
      totalMinutes: entries.reduce((sum, e) => sum + Number(e.minutes), 0),
    }));
}
