import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { env } from '../config.js';

export type Row = Record<string, any>;

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  kind: 'pglite' | 'postgres';
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = normalize(v);
    return out;
  }
  return value;
}

function normalizeRows(rows: unknown[]): Row[] {
  return rows.map((r) => normalize(r) as Row);
}

export interface DbOptions {
  databaseUrl?: string;
  dataDir?: string;
}

export async function createDb(options: DbOptions = {}): Promise<Db> {
  const databaseUrl = options.databaseUrl ?? env.databaseUrl;
  const dataDir = options.dataDir ?? env.dataDir;

  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    const query = async <T = Row>(sql: string, params?: unknown[]): Promise<T[]> => {
      const res = await pool.query(sql, params as any[] | undefined);
      return normalizeRows(res.rows) as T[];
    };
    return {
      kind: 'postgres',
      query,
      async exec(sql) {
        await pool.query(sql);
      },
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const tx: Queryable = {
            async query<T = Row>(sql: string, params?: unknown[]) {
              const res = await client.query(sql, params as any[] | undefined);
              return normalizeRows(res.rows) as T[];
            },
          };
          const result = await fn(tx);
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw err;
        } finally {
          client.release();
        }
      },
      async close() {
        await pool.end();
      },
    };
  }

  await mkdir(dataDir, { recursive: true });
  const lite = new PGlite(dataDir);
  await lite.waitReady;
  const query = async <T = Row>(sql: string, params?: unknown[]): Promise<T[]> => {
    const res = await lite.query(sql, params as any[] | undefined);
    return normalizeRows(res.rows) as T[];
  };
  const db: Db = {
    kind: 'pglite',
    query,
    async exec(sql) {
      await lite.exec(sql);
    },
    async transaction(fn) {
      return lite.transaction(async (tx) => {
        const wrapped: Queryable = {
          async query<T = Row>(sql: string, params?: unknown[]) {
            const res = await tx.query(sql, params as any[] | undefined);
            return normalizeRows(res.rows) as T[];
          },
        };
        return fn(wrapped);
      });
    },
    async close() {
      await lite.close();
    },
  };
  return db;
}

export async function migrate(db: Db): Promise<string[]> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
  );
  const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    const existing = await db.query<{ id: string }>('SELECT id FROM schema_migrations WHERE id = $1', [file]);
    if (existing.length) continue;
    const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
    await db.exec(sql);
    await db.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
    applied.push(file);
  }
  return applied;
}
