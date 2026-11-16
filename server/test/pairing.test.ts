import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, listDevices, register, startTestServer, type TestServer } from './helpers.js';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

describe('device pairing', () => {
  it('walks the full consent handshake: code, child confirmation, parent approval', async () => {
    const parent = await register(server, 'Pairing Parent');

    const created = await call(server, '/pairings', {
      method: 'POST',
      token: parent.token,
      body: { childName: 'Kabir' },
    });
    expect(created.status).toBe(201);
    expect(created.body.pairing.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(created.body.pairing.status).toBe('waiting_child');
    const pairingId = created.body.pairing.id as string;
    const code = created.body.pairing.code as string;

    const paired = await call(server, '/child/pair', {
      method: 'POST',
      body: { code, childName: 'Kabir', platform: 'android', model: 'Pixel Test', osVersion: 'Android 15' },
    });
    expect(paired.status).toBe(201);
    expect(paired.body.status).toBe('awaiting_parent');
    const deviceToken = paired.body.tokens.accessToken as string;
    const deviceId = paired.body.deviceId as string;

    // Until the parent approves, the device is not fully linked.
    const beforeApproval = await call(server, '/child/me', { token: deviceToken });
    expect(beforeApproval.status).toBe(200);
    expect(beforeApproval.body.pairing.status).toBe('awaiting_parent');

    const approved = await call(server, `/pairings/${pairingId}/approve`, {
      method: 'POST',
      token: parent.token,
      body: {},
    });
    expect(approved.status).toBe(200);
    expect(approved.body.device.id).toBe(deviceId);

    const afterApproval = await call(server, '/child/me', { token: deviceToken });
    expect(afterApproval.status).toBe(200);
    expect(afterApproval.body.pairing.status).toBe('linked');
    expect(afterApproval.body.parents.map((p: { displayName: string }) => p.displayName)).toContain('Pairing Parent');

    const devices = await listDevices(server, parent);
    expect(devices.some((d) => d.id === deviceId)).toBe(true);
  });

  it('refuses to reuse a pairing code', async () => {
    const parent = await register(server, 'Code Reuse Parent');
    const created = await call(server, '/pairings', {
      method: 'POST',
      token: parent.token,
      body: { childName: 'Neel' },
    });
    const code = created.body.pairing.code as string;

    const first = await call(server, '/child/pair', { method: 'POST', body: { code } });
    expect(first.status).toBe(201);

    const second = await call(server, '/child/pair', { method: 'POST', body: { code } });
    expect(second.status).toBe(409);
  });

  it('does not let a parent approve another family pairing', async () => {
    const owner = await register(server, 'Owner One');
    const stranger = await register(server, 'Owner Two');

    const created = await call(server, '/pairings', {
      method: 'POST',
      token: owner.token,
      body: { childName: 'Ira' },
    });
    const code = created.body.pairing.code as string;
    const pairingId = created.body.pairing.id as string;
    await call(server, '/child/pair', { method: 'POST', body: { code } });

    const attempt = await call(server, `/pairings/${pairingId}/approve`, {
      method: 'POST',
      token: stranger.token,
      body: {},
    });
    expect(attempt.status).toBe(403);
  });

  it('reports a child awaiting-parent pairing in the parent pairing list', async () => {
    const parent = await register(server, 'Pending Parent');
    const created = await call(server, '/pairings', {
      method: 'POST',
      token: parent.token,
      body: { childName: 'Ravi' },
    });
    await call(server, '/child/pair', {
      method: 'POST',
      body: { code: created.body.pairing.code, childName: 'Ravi' },
    });

    const list = await call(server, '/pairings', { token: parent.token });
    expect(list.status).toBe(200);
    expect(list.body.pairings.some((p: { status: string }) => p.status === 'awaiting_parent')).toBe(true);
  });
});
