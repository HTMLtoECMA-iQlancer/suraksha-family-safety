import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, freshEmail, register, startTestServer, type TestServer } from './helpers.js';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

describe('authentication', () => {
  it('registers a new parent with an owner family and usable tokens', async () => {
    const account = await register(server, 'Asha Patel');
    expect(account.token).toBeTruthy();
    expect(account.refreshToken).toBeTruthy();

    const me = await call(server, '/me', { token: account.token });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(account.email);
    expect(me.body.families[0].role).toBe('owner');
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const email = freshEmail('dup');
    await register(server, 'First Parent', email);

    const duplicate = await call(server, '/auth/register', {
      method: 'POST',
      body: { email, password: 'SafePass123', displayName: 'Second Parent' },
    });
    expect(duplicate.status).toBe(409);

    const weak = await call(server, '/auth/register', {
      method: 'POST',
      body: { email: freshEmail('weak'), password: 'short', displayName: 'Weak Password' },
    });
    expect(weak.status).toBe(400);
  });

  it('logs in with the right password and rejects a wrong one', async () => {
    const account = await register(server, 'Login Tester');

    const ok = await call(server, '/auth/login', {
      method: 'POST',
      body: { email: account.email, password: account.password },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.tokens.accessToken).toBeTruthy();

    const bad = await call(server, '/auth/login', {
      method: 'POST',
      body: { email: account.email, password: 'WrongPass999' },
    });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toMatch(/incorrect/i);
  });

  it('requires a bearer token for protected parent routes', async () => {
    const res = await call(server, '/devices');
    expect(res.status).toBe(401);
  });

  it('rotates refresh tokens and rejects reuse of the old one', async () => {
    const account = await register(server, 'Refresh Tester');

    const first = await call(server, '/auth/refresh', {
      method: 'POST',
      body: { refreshToken: account.refreshToken },
    });
    expect(first.status).toBe(200);
    const rotated: string = first.body.tokens.refreshToken;
    expect(rotated).not.toBe(account.refreshToken);

    const reuse = await call(server, '/auth/refresh', {
      method: 'POST',
      body: { refreshToken: account.refreshToken },
    });
    expect(reuse.status).toBe(401);

    const second = await call(server, '/auth/refresh', {
      method: 'POST',
      body: { refreshToken: rotated },
    });
    expect(second.status).toBe(200);
  });

  it('revokes a refresh token on logout', async () => {
    const account = await register(server, 'Logout Tester');

    const logout = await call(server, '/auth/logout', {
      method: 'POST',
      body: { refreshToken: account.refreshToken },
    });
    expect(logout.status).toBe(204);

    const after = await call(server, '/auth/refresh', {
      method: 'POST',
      body: { refreshToken: account.refreshToken },
    });
    expect(after.status).toBe(401);
  });
});
