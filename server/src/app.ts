import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppConfig } from '@suraksha/shared';
import { env } from './config.js';
import { createDb, migrate, type Db } from './lib/db.js';
import { errorHandler, rateLimit } from './lib/http.js';
import { Hub } from './realtime.js';
import { authRoutes } from './routes/auth.routes.js';
import { familyRoutes } from './routes/family.routes.js';
import { deviceRoutes } from './routes/device.routes.js';
import { sessionRoutes } from './routes/session.routes.js';
import { locationRoutes } from './routes/location.routes.js';
import { childRoutes } from './routes/child.routes.js';
import { metaRoutes } from './routes/meta.routes.js';
import { seedDemo } from './seed.js';
import type { SessionRow, DeviceRow } from './lib/models.js';
import { toSession } from './lib/models.js';
import { writeAudit } from './lib/events.js';

export interface AppContext {
  app: Express;
  server: Server;
  db: Db;
  hub: Hub;
  close: () => Promise<void>;
}

export interface CreateAppOptions {
  db?: Db;
  seed?: boolean;
  serveStatic?: boolean;
}

export async function createApp(options: CreateAppOptions = {}): Promise<AppContext> {
  const db = options.db ?? (await createDb());
  await migrate(db);

  const hub = new Hub(db);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://tile.openstreetmap.org'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'https:', 'http:'],
          mediaSrc: ["'self'", 'blob:'],
          fontSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.corsOrigins.includes(origin)) callback(null, true);
        else callback(null, false);
      },
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/health') return;
      console.log(`[suraksha] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', db: db.kind, version: '1.0.0', time: new Date().toISOString() });
  });

  app.get('/api/config', (_req, res) => {
    const config: AppConfig = {
      demoMode: env.demoMode,
      publicBaseUrl: env.publicBaseUrl,
      turnUrls: env.turnUrls,
      turnUsername: env.turnUsername,
      turnCredential: env.turnCredential,
      locationRetentionDays: env.locationRetentionDays,
    };
    res.json(config);
  });

  app.use('/api', rateLimit({ name: 'global', windowMs: 60_000, max: 600 }));

  app.use('/api', authRoutes(db));
  app.use('/api', familyRoutes(db, hub));
  app.use('/api', deviceRoutes(db, hub));
  app.use('/api', sessionRoutes(db, hub));
  app.use('/api', locationRoutes(db));
  app.use('/api', childRoutes(db, hub));
  app.use('/api', metaRoutes(db, hub));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'API route not found' } });
  });

  if (options.serveStatic !== false && existsSync(env.webDistPath)) {
    app.use(express.static(env.webDistPath, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
      res.sendFile(`${env.webDistPath}/index.html`);
    });
  }

  app.use(errorHandler);

  const server = createServer(app);
  hub.attach(server);

  if (env.demoMode && options.seed !== false) {
    await seedDemo(db);
  }

  const sessionTimer = setInterval(() => {
    void expirePendingSessions(db, hub);
  }, 10_000);
  sessionTimer.unref();

  const presenceTimer = setInterval(() => {
    void sweepOfflineDevices(db, hub);
  }, 60_000);
  presenceTimer.unref();

  void basicRetention(db);
  const retentionTimer = setInterval(() => {
    void basicRetention(db);
  }, 6 * 60 * 60 * 1000);
  retentionTimer.unref();

  const close = async () => {
    clearInterval(sessionTimer);
    clearInterval(presenceTimer);
    clearInterval(retentionTimer);
    await hub.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  };

  return { app, server, db, hub, close };
}

async function expirePendingSessions(db: Db, hub: Hub): Promise<void> {
  try {
    const rows = await db.query<SessionRow>(
      `SELECT * FROM session_requests WHERE status = 'pending' AND created_at <= now() - interval '2 minutes'`,
    );
    for (const row of rows) {
      const updated = await db.query<SessionRow>(
        `UPDATE session_requests SET status = 'expired', responded_at = now(), ended_at = now(), ended_by = 'system'
         WHERE id = $1 RETURNING *`,
        [row.id],
      );
      const session = toSession(updated[0]);
      await writeAudit(db, {
        familyId: row.family_id,
        deviceId: row.device_id,
        sessionId: row.id,
        actorType: 'system',
        action: 'session.expired',
      });
      hub.sendToUser(row.parent_user_id, { type: 'session.update', data: { session } });
      hub.sendToDevice(row.device_id, { type: 'session.update', data: { session } });
    }
  } catch (err) {
    console.error('[suraksha] failed to expire sessions', err);
  }
}

async function sweepOfflineDevices(db: Db, hub: Hub): Promise<void> {
  try {
    const rows = await db.query<DeviceRow>(
      `SELECT * FROM devices WHERE unlinked_at IS NULL AND status = 'online'
       AND (last_seen_at IS NULL OR last_seen_at <= now() - interval '2 minutes')`,
    );
    for (const row of rows) {
      if (hub.isDeviceOnline(row.id)) continue;
      await db.query("UPDATE devices SET status = 'offline' WHERE id = $1", [row.id]);
      hub.broadcastToFamily(row.family_id, {
        type: 'device.status',
        data: {
          deviceId: row.id,
          status: 'offline',
          online: false,
          battery: row.battery,
          network: row.network,
          lastSeenAt: row.last_seen_at,
        },
      });
    }
  } catch (err) {
    console.error('[suraksha] failed to sweep offline devices', err);
  }
}

async function basicRetention(db: Db): Promise<void> {
  try {
    const locationCutoff = new Date(Date.now() - env.locationRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    const eventCutoff = new Date(Date.now() - env.eventRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    await db.query('DELETE FROM locations WHERE recorded_at < $1', [locationCutoff]);
    await db.query('DELETE FROM safety_events WHERE occurred_at < $1', [eventCutoff]);
    await db.query("DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'");
    await db.query(
      "DELETE FROM device_pairings WHERE expires_at < now() - interval '1 day' AND status IN ('expired','cancelled')",
    );
  } catch (err) {
    console.error('[suraksha] retention cleanup failed', err);
  }
}
