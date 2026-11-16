import type {
  AuditLog,
  AuthTokens,
  Device,
  Family,
  FamilyMember,
  Geofence,
  LocationPoint,
  NotificationItem,
  Pairing,
  PolicyKind,
  PolicyMap,
  SafetyEvent,
  SessionRequest,
  UsageDay,
  User,
} from '@suraksha/shared';

export type * from '@suraksha/shared';

const ACCESS_KEY = 'suraksha.accessToken';
const REFRESH_KEY = 'suraksha.refreshToken';
const EXPIRES_KEY = 'suraksha.accessExpiresAt';

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  get expiresAt(): number {
    return Number(localStorage.getItem(EXPIRES_KEY) ?? 0);
  },
  set(tokens: AuthTokens) {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    localStorage.setItem(EXPIRES_KEY, String(Date.parse(tokens.accessExpiresAt)));
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(EXPIRES_KEY);
  },
};

let refreshing: Promise<boolean> | null = null;

export async function refreshTokens(): Promise<boolean> {
  if (refreshing) return refreshing;
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return false;
  refreshing = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { tokens: AuthTokens };
      tokenStore.set(data.tokens);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

function signOutEverywhere() {
  tokenStore.clear();
  window.dispatchEvent(new Event('suraksha:signed-out'));
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  const run = async (token: string | null) => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth && token) headers.authorization = `Bearer ${token}`;
    return fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  let token = auth ? tokenStore.access : null;
  // Refresh shortly before expiry so navigation does not fail mid-session.
  if (auth && tokenStore.refresh && tokenStore.expiresAt && tokenStore.expiresAt - Date.now() < 45_000) {
    if (await refreshTokens()) token = tokenStore.access;
  }
  let res = await run(token);
  if (res.status === 401 && auth && tokenStore.refresh) {
    if (await refreshTokens()) {
      res = await run(tokenStore.access);
    } else {
      signOutEverywhere();
    }
  }
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && auth) signOutEverywhere();
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'request_failed',
      data?.error?.message ?? `Request failed (${res.status})`,
      data?.error?.details,
    );
  }
  return data as T;
}

export function wsUrl(token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}

export async function downloadExport(): Promise<void> {
  const res = await fetch('/api/me/export', {
    headers: { authorization: `Bearer ${tokenStore.access}` },
  });
  if (!res.ok) throw new ApiError(res.status, 'export_failed', 'Could not export your data');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `suraksha-export-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- response shapes ---------- */

export interface AuthResponse {
  user: User;
  families: Family[];
  tokens: AuthTokens;
}

export interface MeResponse {
  user: User;
  families: Family[];
}

export interface OverviewResponse {
  device: Device;
  policies: PolicyMap;
  usage: { days: UsageDay[]; totalMinutes: number };
  events: SafetyEvent[];
  location: LocationPoint | null;
  geofences: Geofence[];
  sessions: SessionRequest[];
  openSession: SessionRequest | null;
}

export interface DevicesResponse {
  devices: Device[];
}

export interface PairingResponse {
  pairing: Pairing & { code?: string };
}

export interface SessionResponse {
  session: SessionRequest;
}

export interface UsageResponse {
  days: UsageDay[];
  totalMinutes: number;
}

export interface EventsResponse {
  events: SafetyEvent[];
}

export interface SessionsResponse {
  sessions: SessionRequest[];
}

export interface LocationResponse {
  location: LocationPoint | null;
  sharing: PolicyMap['location'];
}

export interface LocationsResponse {
  points: LocationPoint[];
}

export interface GeofencesResponse {
  geofences: Geofence[];
}

export interface MembersResponse {
  members: FamilyMember[];
}

export interface NotificationsResponse {
  notifications: NotificationItem[];
}

export interface PoliciesResponse {
  policies: PolicyMap;
}

export interface AuditResponse {
  audit: AuditLog[];
}

export interface ConfigResponse {
  demoMode: boolean;
  publicBaseUrl: string;
  turnUrls: string[];
  turnUsername: string;
  turnCredential: string;
  locationRetentionDays: number;
}

export interface AppsResponse {
  apps: { package: string; appName: string; category: string; minutes: number; blocked: boolean; limitMinutes: number | null }[];
}

export async function updatePolicy(deviceId: string, kind: PolicyKind, payload: unknown): Promise<PolicyMap> {
  const res = await apiFetch<PoliciesResponse>(`/devices/${deviceId}/policies/${kind}`, { method: 'PUT', body: payload });
  return res.policies;
}
