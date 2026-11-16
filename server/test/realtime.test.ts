import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  call,
  pairDevice,
  register,
  requestSession,
  startTestServer,
  type Account,
  type PairedChild,
  type TestServer,
} from './helpers.js';

interface SocketProbe {
  ws: WebSocket;
  next: (type: string, timeoutMs?: number) => Promise<any>;
  close: () => void;
}

function connect(server: TestServer, token: string): Promise<SocketProbe> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${server.wsUrl}?token=${encodeURIComponent(token)}`);
    const queue: any[] = [];
    const waiters: Array<{ type: string; resolve: (msg: any) => void; timer: NodeJS.Timeout }> = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const index = waiters.findIndex((w) => w.type === msg.type);
      if (index >= 0) {
        const waiter = waiters.splice(index, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      } else {
        queue.push(msg);
      }
    });
    ws.on('error', reject);
    ws.on('open', () => {
      resolve({
        ws,
        next(type, timeoutMs = 3000) {
          const queued = queue.findIndex((m) => m.type === type);
          if (queued >= 0) return Promise.resolve(queue.splice(queued, 1)[0]);
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              const idx = waiters.findIndex((w) => w.timer === timer);
              if (idx >= 0) waiters.splice(idx, 1);
              rej(new Error(`Timed out waiting for ${type}`));
            }, timeoutMs);
            waiters.push({ type, resolve: res, timer });
          });
        },
        close() {
          ws.close();
        },
      });
    });
  });
}

let server: TestServer;
let parent: Account;
let child: PairedChild;

beforeAll(async () => {
  server = await startTestServer();
  parent = await register(server, 'Realtime Parent');
  child = await pairDevice(server, parent);
});

afterAll(async () => {
  await server.close();
});

describe('websocket signalling', () => {
  it('greets parent and device sockets with a hello', async () => {
    const parentSocket = await connect(server, parent.token);
    const deviceSocket = await connect(server, child.accessToken);

    const parentHello = await parentSocket.next('hello');
    const deviceHello = await deviceSocket.next('hello');
    expect(parentHello.data.kind).toBe('user');
    expect(deviceHello.data.kind).toBe('device');
    expect(deviceHello.data.deviceId).toBe(child.deviceId);

    parentSocket.close();
    deviceSocket.close();
  });

  it('delivers a session request to the device and relays approval-gated signals', async () => {
    const parentSocket = await connect(server, parent.token);
    const deviceSocket = await connect(server, child.accessToken);
    await parentSocket.next('hello');
    await deviceSocket.next('hello');

    const session = await requestSession(server, parent, child.deviceId, 'camera', 'Realtime check');
    const request = await deviceSocket.next('session.request');
    expect(request.data.session.id).toBe(session.id);
    expect(request.data.session.status).toBe('pending');

    // Signalling before approval must be refused.
    deviceSocket.ws.send(
      JSON.stringify({ type: 'webrtc.ready', sessionId: session.id }),
    );
    const refusal = await deviceSocket.next('error');
    expect(refusal.data.code).toBe('not_approved');

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
    await parentSocket.next('session.update');
    await parentSocket.next('session.update');

    deviceSocket.ws.send(JSON.stringify({ type: 'webrtc.ready', sessionId: session.id }));
    const ready = await parentSocket.next('webrtc.ready');
    expect(ready.from).toBe('child');
    expect(ready.sessionId).toBe(session.id);

    deviceSocket.ws.send(
      JSON.stringify({
        type: 'signal',
        sessionId: session.id,
        payload: { kind: 'offer', sdp: { type: 'offer', sdp: 'v=0 test' } },
      }),
    );
    const signal = await parentSocket.next('signal');
    expect(signal.from).toBe('child');
    expect(signal.payload.kind).toBe('offer');

    parentSocket.ws.send(
      JSON.stringify({ type: 'signal', sessionId: session.id, payload: { kind: 'answer' } }),
    );
    const downstream = await deviceSocket.next('signal');
    expect(downstream.from).toBe('parent');

    await call(server, `/sessions/${session.id}/end`, { method: 'POST', token: parent.token, body: {} });
    parentSocket.close();
    deviceSocket.close();
  });

  it('closes sockets that present an invalid token', async () => {
    await expect(connect(server, 'not-a-token')).rejects.toBeTruthy();
  });
});
