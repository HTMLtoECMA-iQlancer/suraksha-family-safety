import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  heartbeat,
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

beforeAll(async () => {
  server = await startTestServer();
  parent = await register(server, 'Session Parent');
  child = await pairDevice(server, parent);
  await heartbeat(server, child);
});

afterAll(async () => {
  await server.close();
});

describe('live session consent flow', () => {
  it('requires child approval before a camera session can start', async () => {
    const session = await requestSession(server, parent, child.deviceId, 'camera', 'Homework check');
    expect(session.status).toBe('pending');

    // Only one open request per device.
    const second = await call(server, `/devices/${child.deviceId}/sessions`, {
      method: 'POST',
      token: parent.token,
      body: { kind: 'audio', reason: 'Duplicate' },
    });
    expect(second.status).toBe(409);

    // The child sees the request and can start only after approving.
    const pending = await call(server, '/child/session-requests?status=open', { token: child.accessToken });
    expect(pending.status).toBe(200);
    expect(pending.body.sessions.some((s: { id: string }) => s.id === session.id)).toBe(true);

    const earlyStart = await call(server, `/child/sessions/${session.id}/start`, {
      method: 'POST',
      token: child.accessToken,
      body: {},
    });
    expect(earlyStart.status).toBe(409);

    const approved = await call(server, `/child/session-requests/${session.id}/respond`, {
      method: 'POST',
      token: child.accessToken,
      body: { approve: true, reason: 'Approved by child' },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.session.status).toBe('approved');

    const started = await call(server, `/child/sessions/${session.id}/start`, {
      method: 'POST',
      token: child.accessToken,
      body: {},
    });
    expect(started.status).toBe(200);
    expect(started.body.session.status).toBe('active');
    expect(started.body.session.startedAt).toBeTruthy();

    const endedByChild = await call(server, `/child/sessions/${session.id}/end`, {
      method: 'POST',
      token: child.accessToken,
      body: { reason: 'child_stopped' },
    });
    expect(endedByChild.status).toBe(200);
    expect(endedByChild.body.session.status).toBe('ended');
    expect(endedByChild.body.session.endedBy).toBe('child');
  });

  it('records a declined request and blocks the session', async () => {
    const session = await requestSession(server, parent, child.deviceId, 'audio', 'Mic check');

    const denied = await call(server, `/child/session-requests/${session.id}/respond`, {
      method: 'POST',
      token: child.accessToken,
      body: { approve: false, reason: 'Not comfortable' },
    });
    expect(denied.status).toBe(200);
    expect(denied.body.session.status).toBe('denied');

    const start = await call(server, `/child/sessions/${session.id}/start`, {
      method: 'POST',
      token: child.accessToken,
      body: {},
    });
    expect(start.status).toBe(409);
  });

  it('lets the parent stop an approved session and records who ended it', async () => {
    const session = await requestSession(server, parent, child.deviceId, 'screen', 'Screen share');
    await call(server, `/child/session-requests/${session.id}/respond`, {
      method: 'POST',
      token: child.accessToken,
      body: { approve: true },
    });
    await call(server, `/child/sessions/${session.id}/start`, {
      method: 'POST',
      token: child.accessToken,
      body: {},
    });

    const ended = await call(server, `/sessions/${session.id}/end`, {
      method: 'POST',
      token: parent.token,
      body: {},
    });
    expect(ended.status).toBe(200);
    expect(ended.body.session.status).toBe('ended');
    expect(ended.body.session.endedBy).toBe('parent');
  });

  it('blocks a device from answering another device\'s session', async () => {
    const otherChild = await pairDevice(server, parent, 'Diya');
    const session = await requestSession(server, parent, child.deviceId, 'camera', 'Wrong device');

    const attempt = await call(server, `/child/session-requests/${session.id}/respond`, {
      method: 'POST',
      token: otherChild.accessToken,
      body: { approve: true },
    });
    expect(attempt.status).toBe(404);

    const cleanup = await call(server, `/sessions/${session.id}/cancel`, {
      method: 'POST',
      token: parent.token,
      body: {},
    });
    expect(cleanup.status).toBe(200);
  });

  it('rejects parent tokens on child-only endpoints', async () => {
    const session = await requestSession(server, parent, child.deviceId, 'camera', 'Parent token check');
    const res = await call(server, `/child/session-requests/${session.id}/respond`, {
      method: 'POST',
      token: parent.token,
      body: { approve: true },
    });
    expect(res.status).toBe(401);

    await call(server, `/sessions/${session.id}/cancel`, { method: 'POST', token: parent.token, body: {} });
  });

  it('writes an audit trail for every consent step', async () => {
    const session = await requestSession(server, parent, child.deviceId, 'camera', 'Audit trail');
    await call(server, `/child/session-requests/${session.id}/respond`, {
      method: 'POST',
      token: child.accessToken,
      body: { approve: true },
    });
    await call(server, `/child/sessions/${session.id}/start`, {
      method: 'POST',
      token: child.accessToken,
      body: {},
    });
    await call(server, `/child/sessions/${session.id}/end`, {
      method: 'POST',
      token: child.accessToken,
      body: {},
    });

    const audit = await call(server, `/families/${parent.familyId}/audit`, { token: parent.token });
    expect(audit.status).toBe(200);
    const actions = audit.body.audit
      .filter((entry: { sessionId: string | null }) => entry.sessionId === session.id)
      .map((entry: { action: string }) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining(['session.requested', 'session.approved', 'session.started', 'session.ended']),
    );
  });
});
