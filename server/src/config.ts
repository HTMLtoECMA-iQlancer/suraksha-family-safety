import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

function loadDotEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadDotEnv();

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const isProduction = process.env.NODE_ENV === 'production';
const defaultSecret = 'dev-only-secret-do-not-use-in-production-32chars!!';
const jwtSecret = process.env.JWT_SECRET?.trim() || defaultSecret;

if (isProduction && jwtSecret === defaultSecret) {
  // Fail closed instead of shipping a predictable signing key.
  throw new Error('JWT_SECRET must be set to a strong random value in production');
}
if (!isProduction && jwtSecret === defaultSecret) {
  console.warn('[suraksha] Using development JWT secret. Set JWT_SECRET before deploying.');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret,
  accessTtlSeconds: 15 * 60,
  refreshTtlDays: 30,
  deviceRefreshTtlDays: 90,
  databaseUrl: process.env.DATABASE_URL?.trim() || '',
  dataDir: resolve(process.cwd(), 'data'),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  demoMode: bool(process.env.DEMO_MODE, !isProduction),
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim() || 'http://localhost:4000',
  turnUrls: (process.env.TURN_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  turnUsername: process.env.TURN_USERNAME ?? '',
  turnCredential: process.env.TURN_CREDENTIAL ?? '',
  locationRetentionDays: Number(process.env.LOCATION_RETENTION_DAYS ?? 30),
  eventRetentionDays: Number(process.env.EVENT_RETENTION_DAYS ?? 180),
  fcmServiceAccountJson: process.env.FCM_SERVICE_ACCOUNT_JSON ?? '',
  webDistPath:
    process.env.WEB_DIST_PATH?.trim() ||
    resolve(fileURLToPath(new URL('../../parent-app/dist', import.meta.url))),
};

export type Env = typeof env;
