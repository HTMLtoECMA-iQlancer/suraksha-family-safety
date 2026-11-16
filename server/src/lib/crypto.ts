import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../config.js';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const secretKey = new TextEncoder().encode(env.jwtSecret);

export interface AccessPayload {
  sub: string;
  typ: 'user' | 'device';
  fid?: string;
  name?: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, hashText] = parts;
  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    const derived = await scrypt(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function pairingCodeHash(code: string): string {
  return createHmac('sha256', env.jwtSecret).update(`pair:${code.toUpperCase()}`).digest('hex');
}

export function inviteCodeHash(code: string): string {
  return createHmac('sha256', env.jwtSecret).update(`invite:${code.toUpperCase()}`).digest('hex');
}

export function generateCode(length = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i += 1) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

export function generatePairingCode(): string {
  return generateCode(6);
}

export async function signAccessToken(payload: AccessPayload, ttlSeconds = env.accessTtlSeconds): Promise<string> {
  return new SignJWT({ typ: payload.typ, fid: payload.fid, name: payload.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey);
}

export async function verifyAccessToken(token: string): Promise<AccessPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ['HS256'] });
    if (!payload.sub) return null;
    if (payload.typ !== 'user' && payload.typ !== 'device') return null;
    return {
      sub: payload.sub,
      typ: payload.typ,
      fid: typeof payload.fid === 'string' ? payload.fid : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  } catch {
    return null;
  }
}
