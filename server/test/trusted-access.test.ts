import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  heartbeat,
  listDevices,
  pairDevice,
  register,
  requestSession,
  startTestServer,
  type Account,
  type PairedChild,
  type TestServer,
} from './helpers.js';

let server: TestServer;
let parent: Account;
let child: PairedChild;

async function setTrusted(enabled: boolean) {
  return call(server, '/child/trusted-access', {
    method: 'POST',
    token: child.accessToken,
    body: { enabled, confirmed: true },
  });
}

beforeAll(async () => {
  server = await startTestServer();
  parent = await register(server, 'Trusted Parent');
  child = await pairDevice(server, parent);
  await heartbeat(server, child);
});

afterAll(async () => {
  await server.close();
});

describe('child-controlled quick check-ins', () => {
  it('starts a camera check without a new approval only after the child enables it', async () => {
    const before = await requestSession(server, parent, child.deviceId, 'camera', 'Before consent');
    expect(before.status).toBe('pending');
    await call(server, `/sessions/${before.id}/cancel`, { method: 'POST', token: parent.token, body: {} });

    const enabled = await setTrusted(true);
    expect(enabled.status).toBe(200);
    expect(enabled.body.trustedCheckIn.enabled).toBe(true);
    expect(enabled.body.trustedCheckIn.kinds).toEqual(['camera', 'audio']);

    const devices = await listDevices(server, parent);
    expect(devices.find((device) => device.id === child.deviceId)?.trustedCheckIn.enabled).toBe(true);

    const session = await requestSession(server, parent, child.deviceId, 'camera', 'Quick check');
    expect(session.status).toBe('approved');
    expect(session.trusted).toBe(true);
    expect(session.respondedAt).toBeTruthy();

    const started = await call(server, `/child/sessions/${session.id}/start`, {
      method: 'POST',
      token: child.accessToken,
      body: {},
    });
    expect(started.status).toBe(200);
    expect(started.body.session.status).toBe('active');

    const ended = await call(server, `/child/sessions/${session.id}/end`, {
      method: 'POST',
      token: child.accessToken,
      body: { reason: 'child_stopped' },
    });
    expect(ended.status).toBe(200);
    expect(ended.body.session.endedBy).toBe('child');

    const audit = await call(server, `/families/${parent.familyId}/audit`, { token: parent.token });
    const actions = audit.body.audit.map((entry: { action: string }) => entry.action);
    expect(actions).toContain('trusted_check_in.enabled');
    expect(actions).toContain('session.trusted_started');

    await setTrusted(false);
  });

  it('ends a running quick check-in when the child turns the feature off and asks for approval afterwards', async () => {
    await setTrusted(true);
    const session = await requestSession(server, parent, child.deviceId, 'audio', 'Listening check');
    expect(session.status).toBe('approved');

    await call(server, `/child/sessions/${session.id}/start`, {
      method: 'POST',
      token: child.accessToken,
      body: {},
    });

    const disabled = await setTrusted(false);
    expect(disabled.status).toBe(200);
    expect(disabled.body.trustedCheckIn.enabled).toBe(false);

    const afterDisable = await call(server, `/sessions/${session.id}`, { token: parent.token });
    expect(afterDisable.status).toBe(200);
    expect(afterDisable.body.session.status).toBe('ended');
    expect(afterDisable.body.session.endedBy).toBe('child');

    const next = await requestSession(server, parent, child.deviceId, 'audio', 'Needs approval');
    expect(next.status).toBe('pending');
    expect(next.trusted).toBe(false);
    await call(server, `/sessions/${next.id}/cancel`, { method: 'POST', token: parent.token, body: {} });
  });

  it('never auto-approves screen sharing because Android requires its own consent', async () => {
    await setTrusted(true);
    const session = await requestSession(server, parent, child.deviceId, 'screen', 'Screen check');
    expect(session.status).toBe('pending');
    expect(session.trusted).toBe(false);
    await call(server, `/sessions/${session.id}/cancel`, { method: 'POST', token: parent.token, body: {} });
    await setTrusted(false);
  });

  it('rejects parent tokens on the child-only quick check-in endpoint', async () => {
    const res = await call(server, '/child/trusted-access', {
      method: 'POST',
      token: parent.token,
      body: { enabled: true, confirmed: true },
    });
    expect(res.status).toBe(401);
  });
});
