/**
 * Shared contracts between the Suraksha API, parent dashboard and child apps.
 * Keep this file dependency-free so it can run in browsers and Node.
 */

export type Locale = 'en' | 'gu';
export type UserRole = 'owner' | 'parent' | 'caregiver';
export type MemberStatus = 'active' | 'invited' | 'revoked';
export type DeviceStatus = 'online' | 'offline';
export type Platform = 'android' | 'web-preview' | 'ios-preview';

export type SessionKind = 'camera' | 'audio' | 'screen';
export type SessionStatus =
  | 'pending'
  | 'approved'
  | 'active'
  | 'ended'
  | 'denied'
  | 'expired'
  | 'cancelled';

export type PairingStatus = 'waiting_child' | 'awaiting_parent' | 'linked' | 'expired' | 'cancelled';

export type EventSeverity = 'info' | 'warning' | 'critical';
export type SafetyEventKind =
  | 'session.requested'
  | 'session.approved'
  | 'session.denied'
  | 'session.started'
  | 'session.ended'
  | 'device.linked'
  | 'device.unlinked'
  | 'device.offline'
  | 'device.online'
  | 'permission.revoked'
  | 'geofence.enter'
  | 'geofence.exit'
  | 'sos.triggered'
  | 'driving.speed'
  | 'content.alert'
  | 'browsing.blocked'
  | 'usage.limit'
  | 'system.notice';

export type PolicyKind =
  | 'screen_time'
  | 'app_rules'
  | 'location'
  | 'safe_browsing'
  | 'notifications'
  | 'supervision'
  | 'instant_block';

export interface User {
  id: string;
  email: string;
  phone: string | null;
  displayName: string;
  locale: Locale;
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export interface Family {
  id: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export interface FamilyMember {
  id: string;
  familyId: string;
  userId: string | null;
  email: string;
  displayName: string;
  role: UserRole;
  status: MemberStatus;
  createdAt: string;
  acceptedAt: string | null;
}

export interface PermissionState {
  key: string;
  label: string;
  granted: boolean;
  requiredFor: string;
  updatedAt: string | null;
}

export interface TrustedCheckIn {
  enabled: boolean;
  kinds: SessionKind[];
  updatedAt: string | null;
}

export interface Device {
  id: string;
  familyId: string;
  childName: string;
  name: string;
  model: string;
  platform: Platform;
  osVersion: string;
  appVersion: string;
  status: DeviceStatus;
  online: boolean;
  battery: number | null;
  network: string | null;
  lastSeenAt: string | null;
  linkedAt: string | null;
  createdAt: string;
  permissions: PermissionState[];
  permissionHealth: number;
  trustedCheckIn: TrustedCheckIn;
}

export interface Pairing {
  id: string;
  code?: string;
  status: PairingStatus;
  childName: string;
  expiresAt: string;
  device?: Pick<Device, 'id' | 'name' | 'model' | 'platform'>;
}

export interface ScreenTimeSchedule {
  enabled: boolean;
  start: string;
  end: string;
  days: number[];
}

export interface ScreenTimePolicy {
  dailyLimitMinutes: number;
  downtime: ScreenTimeSchedule;
  week: { day: number; limitMinutes: number }[];
}

export interface AppRule {
  package: string;
  appName: string;
  category: string;
  blocked: boolean;
  limitMinutes: number | null;
}

export interface AppRulesPolicy {
  rules: AppRule[];
}

export interface LocationPolicy {
  sharingEnabled: boolean;
  historyEnabled: boolean;
  retentionDays: number;
  drivingAlerts: boolean;
  sosEnabled: boolean;
}

export interface SafeBrowsingPolicy {
  enabled: boolean;
  method: 'dns' | 'vpn' | 'browser-extension';
  blockedCategories: string[];
  allowList: string[];
}

export interface NotificationPolicy {
  safetyAlerts: boolean;
  sessionRequests: boolean;
  dailyDigest: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
}

export interface SupervisionPolicy {
  requireApprovalAlways: boolean;
  childCanStopSessions: boolean;
  shareSessionHistoryWithChild: boolean;
}

export interface InstantBlockPolicy {
  active: boolean;
  until: string | null;
}

export interface PolicyMap {
  screen_time: ScreenTimePolicy;
  app_rules: AppRulesPolicy;
  location: LocationPolicy;
  safe_browsing: SafeBrowsingPolicy;
  notifications: NotificationPolicy;
  supervision: SupervisionPolicy;
  instant_block: InstantBlockPolicy;
}

export interface UsageEntry {
  package: string;
  appName: string;
  category: string;
  minutes: number;
}

export interface UsageDay {
  day: string;
  entries: UsageEntry[];
  totalMinutes: number;
}

export interface SafetyEvent {
  id: string;
  familyId: string;
  deviceId: string;
  kind: SafetyEventKind;
  severity: EventSeverity;
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export interface LocationPoint {
  id?: string;
  deviceId: string;
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  recordedAt: string;
}

export interface Geofence {
  id: string;
  familyId: string;
  deviceId: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  notifyOnEnter: boolean;
  notifyOnExit: boolean;
  enabled: boolean;
  createdAt: string;
}

export interface SessionRequest {
  id: string;
  familyId: string;
  deviceId: string;
  parentUserId: string;
  parentName: string;
  kind: SessionKind;
  status: SessionStatus;
  reason: string;
  trusted: boolean;
  createdAt: string;
  respondedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  endedBy: 'parent' | 'child' | 'system' | null;
}

export interface AuditLog {
  id: string;
  familyId: string;
  deviceId: string | null;
  sessionId: string | null;
  actorType: 'parent' | 'child' | 'system' | 'device';
  actorId: string | null;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AppConfig {
  demoMode: boolean;
  publicBaseUrl: string;
  turnUrls: string[];
  turnUsername: string;
  turnCredential: string;
  locationRetentionDays: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface SessionOffer {
  session: SessionRequest;
  device: Pick<Device, 'id' | 'name' | 'childName'>;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  severity: EventSeverity;
  deviceId: string | null;
  at: string;
  read: boolean;
}

export const SESSION_KINDS: SessionKind[] = ['camera', 'audio', 'screen'];
export const SESSION_LABELS: Record<SessionKind, string> = {
  camera: 'Camera session',
  audio: 'Live audio session',
  screen: 'Screen sharing',
};

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  pending: 'Waiting for child approval',
  approved: 'Approved - connecting',
  active: 'Live now',
  ended: 'Ended',
  denied: 'Declined by child',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  parent: 'Parent',
  caregiver: 'Caregiver',
};

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const ANDROID_PERMISSIONS: { key: string; label: string; requiredFor: string }[] = [
  { key: 'camera', label: 'Camera', requiredFor: 'Camera safety sessions' },
  { key: 'microphone', label: 'Microphone', requiredFor: 'Live audio sessions' },
  { key: 'location', label: 'Location (foreground + background)', requiredFor: 'Location sharing and geofence alerts' },
  { key: 'notifications', label: 'Notifications', requiredFor: 'Session requests and safety alerts' },
  { key: 'usage_access', label: 'Usage access', requiredFor: 'Screen-time summaries and app limits' },
  { key: 'screen_capture', label: 'Screen capture (MediaProjection)', requiredFor: 'Approved screen sharing, each session' },
  { key: 'battery_optimization', label: 'Ignore battery optimization (optional)', requiredFor: 'Reliable background heartbeats' },
  { key: 'accessibility', label: 'Accessibility service (optional)', requiredFor: 'Only for device-owner managed blocking' },
];

export const CATEGORY_COLORS: Record<string, string> = {
  Social: '#6b5ce7',
  Education: '#2f80ed',
  Games: '#f2994a',
  Video: '#eb5757',
  Messaging: '#27ae60',
  Productivity: '#2d9cdb',
  Utilities: '#828282',
  Other: '#9aa4b2',
};

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isInsideGeofence(
  point: { lat: number; lng: number },
  fence: { lat: number; lng: number; radiusM: number },
): boolean {
  return haversineMeters(point, fence) <= fence.radiusM;
}

export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isoDayOffset(daysAgo: number, now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  return todayIso(d);
}

/** WebSocket messages shared by the dashboard, child web preview and Android app. */
export type WsClientMessage =
  | { type: 'ping' }
  | { type: 'signal'; sessionId: string; payload: unknown }
  | { type: 'webrtc.ready'; sessionId: string };

export type WsServerMessage =
  | { type: 'hello'; data: { kind: 'user' | 'device'; clientId: string; familyIds: string[]; deviceId?: string } }
  | { type: 'pong' }
  | { type: 'device.status'; data: { deviceId: string; status: DeviceStatus; online: boolean; battery: number | null; network: string | null; lastSeenAt: string | null } }
  | { type: 'session.request'; data: { session: SessionRequest } }
  | { type: 'session.update'; data: { session: SessionRequest } }
  | { type: 'signal'; sessionId: string; from: 'parent' | 'child'; payload: unknown }
  | { type: 'webrtc.ready'; sessionId: string; from: 'parent' | 'child' }
  | { type: 'event.new'; data: { event: SafetyEvent } }
  | { type: 'location.update'; data: { point: LocationPoint; deviceName: string } }
  | { type: 'geofence.alert'; data: { event: SafetyEvent; geofence: Geofence } }
  | { type: 'device.unlinked'; data: { deviceId: string } }
  | { type: 'policy.updated'; data: { deviceId: string; kind: PolicyKind } }
  | { type: 'family.changed'; data: { familyId: string } }
  | { type: 'error'; data: { code: string; message: string } };
