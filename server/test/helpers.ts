import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { AuthTokens, Device, Family, SessionRequest } from '@suraksha/shared';
import { createApp, type AppContext } from '../src/app.js';
import { createDb } from '../src/lib/db.js';

export interface TestServer {
  baseUrl: string;
  wsUrl: string;
  ctx: AppContext;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const dir = await mkdtemp(join(tmpdir(), 'suraksha-test-'));
  const db = await createDb({ dataDir: dir });
  const ctx = await createApp({ db, seed: false, serveStatic: false });
  await new Promise<void>((resolve) => ctx.server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = ctx.server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    ctx,
    close: async () => {
      await ctx.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export interface CallOptions {
  method?: string;
  token?: string;
  body?: unknown;
}

export interface ApiResult<T> {
  status: number;
  body: T;
}

export async function call<T = any>(server: TestServer, path: string, options: CallOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(`${server.baseUrl}/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

let counter = 0;

export function freshEmail(prefix = 'parent'): string {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@example.test`;
}

export interface Account {
  email: string;
  password: string;
  token: string;
  refreshToken: string;
  userId: string;
  displayName: string;
  familyId: string;
}

export async function register(
  server: TestServer,
  displayName = 'Test Parent',
  email = freshEmail(),
): Promise<Account> {
  const password = 'SafePass123';
  const { status, body } = await call(server, '/auth/register', {
    method: 'POST',
    body: { email, password, displayName },
  });
  if (status !== 201) throw new Error(`register failed: ${status} ${JSON.stringify(body)}`);
  const tokens = body.tokens as AuthTokens;
  return {
    email,
    password,
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    userId: body.user.id,
    displayName,
    familyId: body.families[0].id,
  };
}

export interface PairedChild {
  deviceId: string;
  pairingId: string;
  accessToken: string;
  refreshToken: string;
}

/** Creates a pairing code with the parent account, pairs a device, and approves it. */
export async function pairDevice(
  server: TestServer,
  parent: Account,
  childName = 'Kabir',
  platform: 'android' | 'web-preview' = 'android',
): Promise<PairedChild> {
  const created = await call(server, '/pairings', {
    method: 'POST',
    token: parent.token,
    body: { childName, familyId: parent.familyId },
  });
  if (created.status !== 201) throw new Error(`pairing create failed: ${created.status}`);
  const { id: pairingId, code } = created.body.pairing;

  const paired = await call(server, '/child/pair', {
    method: 'POST',
    body: { code, childName, platform, model: 'Test Device', osVersion: 'Android 15', appVersion: '1.0.0' },
  });
  if (paired.status !== 201) throw new Error(`child pair failed: ${paired.status} ${JSON.stringify(paired.body)}`);

  const approved = await call(server, `/pairings/${pairingId}/approve`, {
    method: 'POST',
    token: parent.token,
    body: {},
  });
  if (approved.status !== 200) throw new Error(`approve failed: ${approved.status}`);

  return {
    deviceId: paired.body.deviceId,
    pairingId,
    accessToken: paired.body.tokens.accessToken,
    refreshToken: paired.body.tokens.refreshToken,
  };
}

export async function heartbeat(server: TestServer, child: PairedChild): Promise<void> {
  const res = await call(server, '/child/heartbeat', {
    method: 'POST',
    token: child.accessToken,
    body: { battery: 80, network: 'Wi-Fi' },
  });
  if (res.status !== 200) throw new Error(`heartbeat failed: ${res.status}`);
}

export async function requestSession(
  server: TestServer,
  parent: Account,
  deviceId: string,
  kind: 'camera' | 'audio' | 'screen' = 'camera',
  reason = 'Test check-in',
): Promise<SessionRequest> {
  const res = await call(server, `/devices/${deviceId}/sessions`, {
    method: 'POST',
    token: parent.token,
    body: { kind, reason },
  });
  if (res.status !== 201) throw new Error(`session create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.session as SessionRequest;
}

export async function listDevices(server: TestServer, parent: Account): Promise<Device[]> {
  const res = await call(server, '/devices', { token: parent.token });
  return res.body.devices as Device[];
}

export function familyOf(account: Account): Family {
  return { id: account.familyId, name: 'My family', role: 'owner', createdAt: new Date().toISOString() };
}
