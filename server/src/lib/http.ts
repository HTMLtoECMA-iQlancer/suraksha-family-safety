import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { ZodError } from 'zod';

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

export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message);
export const forbidden = (message = 'You do not have access to this resource') =>
  new ApiError(403, 'forbidden', message);
export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'unauthorized', message);
export const conflict = (message: string) => new ApiError(409, 'conflict', message);
export const tooMany = (message = 'Too many requests. Please wait and try again.') =>
  new ApiError(429, 'rate_limited', message);

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

export const ah = (fn: Handler): RequestHandler => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out && typeof (out as Promise<unknown>).catch === 'function') {
      (out as Promise<unknown>).catch(next);
    }
  } catch (err) {
    next(err);
  }
};

export function validate(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      next(new ApiError(400, 'validation_error', 'Please check the highlighted fields', result.error.flatten()));
      return;
    }
    req.body = result.data;
    next();
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'validation_error', message: 'Invalid request', details: err.flatten() },
    });
    return;
  }
  console.error('[suraksha] unhandled error', err);
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong on our side. Please retry.' },
  });
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let cleanupStarted = false;

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  name: string;
  key?: (req: Request) => string;
}

export function rateLimit({ windowMs, max, name, key }: RateLimitOptions): RequestHandler {
  if (!cleanupStarted) {
    cleanupStarted = true;
    setInterval(() => {
      const now = Date.now();
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }, 60_000).unref();
  }
  return (req, res, next) => {
    const id = key ? key(req) : `${name}:${req.ip}`;
    const now = Date.now();
    const existing = buckets.get(id);
    if (!existing || existing.resetAt <= now) {
      buckets.set(id, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    existing.count += 1;
    if (existing.count > max) {
      res.setHeader('Retry-After', Math.ceil((existing.resetAt - now) / 1000));
      next(tooMany());
      return;
    }
    next();
  };
}

export function bearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
