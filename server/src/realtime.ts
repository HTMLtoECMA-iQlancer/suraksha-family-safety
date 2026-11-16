import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { WsServerMessage } from '@suraksha/shared';
import type { Db } from './lib/db.js';
import { verifyAccessToken } from './lib/crypto.js';
import type { DeviceRow, SessionRow, UserRow } from './lib/models.js';

interface ClientMeta {
  kind: 'user' | 'device';
  id: string;
  familyIds: string[];
  deviceId?: string;
  name: string;
}

const SIGNALABLE: SessionRow['status'][] = ['approved', 'active'];

export class Hub {
  private wss = new WebSocketServer({ noServer: true });
  private clients = new Map<WebSocket, ClientMeta>();
  private userSockets = new Map<string, Set<WebSocket>>();
  private deviceSockets = new Map<string, Set<WebSocket>>();
  private alive = new WeakMap<WebSocket, boolean>();
  private messageWindow = new WeakMap<WebSocket, { count: number; resetAt: number }>();
  private heartbeat: NodeJS.Timeout;
  private db: Db;

  constructor(db: Db) {
    this.db = db;
    this.heartbeat = setInterval(() => this.sweep(), 30_000);
    this.heartbeat.unref();
    this.wss.on('error', (err) => console.error('[suraksha] websocket server error', err));
  }

  attach(server: Server): void {
    server.on('upgrade', (req, socket, head) => {
      const path = (req.url ?? '').split('?')[0];
      if (path !== '/ws') {
        socket.destroy();
        return;
      }
      void this.handleUpgrade(req, socket, head);
    });
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) {
        rejectSocket(socket, 401, 'Missing token');
        return;
      }
      const payload = await verifyAccessToken(token);
      if (!payload) {
        rejectSocket(socket, 401, 'Invalid token');
        return;
      }
      let meta: ClientMeta | null = null;
      if (payload.typ === 'user') {
        const users = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [payload.sub]);
        if (!users.length) {
          rejectSocket(socket, 401, 'Account inactive');
          return;
        }
        const families = await this.db.query<{ family_id: string }>(
          "SELECT family_id FROM family_members WHERE user_id = $1 AND status = 'active'",
          [payload.sub],
        );
        meta = {
          kind: 'user',
          id: payload.sub,
          familyIds: families.map((f) => f.family_id),
          name: users[0].display_name,
        };
      } else {
        const devices = await this.db.query<DeviceRow>(
          'SELECT * FROM devices WHERE id = $1 AND unlinked_at IS NULL',
          [payload.sub],
        );
        if (!devices.length) {
          rejectSocket(socket, 401, 'Device unlinked');
          return;
        }
        meta = {
          kind: 'device',
          id: payload.sub,
          familyIds: [devices[0].family_id],
          deviceId: devices[0].id,
          name: devices[0].name,
        };
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.onConnection(ws, meta as ClientMeta);
      });
    } catch (err) {
      console.error('[suraksha] websocket upgrade failed', err);
      socket.destroy();
    }
  }

  private onConnection(ws: WebSocket, meta: ClientMeta): void {
    this.clients.set(ws, meta);
    this.alive.set(ws, true);
    if (meta.kind === 'user') {
      const set = this.userSockets.get(meta.id) ?? new Set();
      set.add(ws);
      this.userSockets.set(meta.id, set);
    } else if (meta.deviceId) {
      const set = this.deviceSockets.get(meta.deviceId) ?? new Set();
      set.add(ws);
      this.deviceSockets.set(meta.deviceId, set);
      void this.markDevice(meta, true);
    }

    this.send(ws, {
      type: 'hello',
      data: {
        kind: meta.kind,
        clientId: meta.id,
        familyIds: meta.familyIds,
        deviceId: meta.deviceId,
      },
    });

    ws.on('pong', () => this.alive.set(ws, true));
    ws.on('message', (raw) => {
      void this.onMessage(ws, meta, raw.toString()).catch((err) => console.error('[suraksha] ws message error', err));
    });
    ws.on('close', () => this.onClose(ws, meta));
    ws.on('error', () => this.onClose(ws, meta));
  }

  private onClose(ws: WebSocket, meta: ClientMeta): void {
    if (!this.clients.has(ws)) return;
    this.clients.delete(ws);
    if (meta.kind === 'user') {
      const set = this.userSockets.get(meta.id);
      set?.delete(ws);
      if (set && !set.size) this.userSockets.delete(meta.id);
    } else if (meta.deviceId) {
      const set = this.deviceSockets.get(meta.deviceId);
      set?.delete(ws);
      if (set && !set.size) {
        this.deviceSockets.delete(meta.deviceId);
        void this.markDevice(meta, false);
      }
    }
  }

  private async markDevice(meta: ClientMeta, online: boolean): Promise<void> {
    if (!meta.deviceId) return;
    const rows = await this.db.query<DeviceRow>(
      online
        ? "UPDATE devices SET status = 'online', last_seen_at = now() WHERE id = $1 AND unlinked_at IS NULL RETURNING *"
        : "UPDATE devices SET status = 'offline', last_seen_at = now() WHERE id = $1 AND unlinked_at IS NULL RETURNING *",
      [meta.deviceId],
    );
    if (!rows.length) return;
    const d = rows[0];
    this.broadcastToFamily(meta.familyIds[0], {
      type: 'device.status',
      data: {
        deviceId: d.id,
        status: online ? 'online' : 'offline',
        online,
        battery: d.battery,
        network: d.network,
        lastSeenAt: d.last_seen_at,
      },
    });
  }

  private async onMessage(ws: WebSocket, meta: ClientMeta, raw: string): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.send(ws, { type: 'error', data: { code: 'bad_json', message: 'Message must be JSON' } });
      return;
    }
    const window = this.messageWindow.get(ws) ?? { count: 0, resetAt: Date.now() + 60_000 };
    if (window.resetAt <= Date.now()) {
      window.count = 0;
      window.resetAt = Date.now() + 60_000;
    }
    window.count += 1;
    this.messageWindow.set(ws, window);
    if (window.count > 300) {
      ws.close(1008, 'Rate limit exceeded');
      return;
    }

    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ping') {
      this.send(ws, { type: 'pong' });
      return;
    }
    if (msg.type === 'signal' || msg.type === 'webrtc.ready') {
      await this.relay(ws, meta, msg);
      return;
    }
    this.send(ws, { type: 'error', data: { code: 'unknown_type', message: 'Unknown message type' } });
  }

  private async relay(ws: WebSocket, meta: ClientMeta, msg: any): Promise<void> {
    const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : '';
    if (!sessionId) {
      this.send(ws, { type: 'error', data: { code: 'bad_signal', message: 'Missing sessionId' } });
      return;
    }
    const rows = await this.db.query<SessionRow>('SELECT * FROM session_requests WHERE id = $1', [sessionId]);
    if (!rows.length) {
      this.send(ws, { type: 'error', data: { code: 'not_found', message: 'Session not found' } });
      return;
    }
    const session = rows[0];
    if (!SIGNALABLE.includes(session.status)) {
      this.send(ws, { type: 'error', data: { code: 'not_approved', message: 'Session is not approved' } });
      return;
    }

    if (meta.kind === 'device' && meta.deviceId === session.device_id) {
      const out =
        msg.type === 'signal'
          ? ({ type: 'signal', sessionId, from: 'child', payload: msg.payload } as WsServerMessage)
          : ({ type: 'webrtc.ready', sessionId, from: 'child' } as WsServerMessage);
      this.sendToUser(session.parent_user_id, out);
      return;
    }
    if (meta.kind === 'user' && meta.id === session.parent_user_id) {
      const out =
        msg.type === 'signal'
          ? ({ type: 'signal', sessionId, from: 'parent', payload: msg.payload } as WsServerMessage)
          : ({ type: 'webrtc.ready', sessionId, from: 'parent' } as WsServerMessage);
      this.sendToDevice(session.device_id, out);
      return;
    }
    this.send(ws, { type: 'error', data: { code: 'forbidden', message: 'You are not part of this session' } });
  }

  send(ws: WebSocket, message: WsServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  sendToUser(userId: string, message: WsServerMessage): void {
    for (const ws of this.userSockets.get(userId) ?? []) this.send(ws, message);
  }

  sendToDevice(deviceId: string, message: WsServerMessage): void {
    for (const ws of this.deviceSockets.get(deviceId) ?? []) this.send(ws, message);
  }

  broadcastToFamily(familyId: string, message: WsServerMessage): void {
    for (const [ws, meta] of this.clients) {
      if (meta.kind === 'user' && meta.familyIds.includes(familyId)) this.send(ws, message);
    }
  }

  isDeviceOnline(deviceId: string): boolean {
    return (this.deviceSockets.get(deviceId)?.size ?? 0) > 0;
  }

  private sweep(): void {
    for (const ws of this.clients.keys()) {
      if (this.alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      this.alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const ws of this.clients.keys()) ws.close(1001, 'Server shutting down');
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

function rejectSocket(socket: Duplex, status: number, message: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  } finally {
    socket.destroy();
  }
}
