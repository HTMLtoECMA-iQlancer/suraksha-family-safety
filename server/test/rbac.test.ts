import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  freshEmail,
  heartbeat,
  listDevices,
  pairDevice,
  register,
  startTestServer,
  type Account,
  type PairedChild,
  type TestServer,
} from './helpers.js';

let server: TestServer;
let owner: Account;
let child: PairedChild;

beforeAll(async () => {
  server = await startTestServer();
  owner = await register(server, 'Family Owner');
  child = await pairDevice(server, owner);
  await heartbeat(server, child);
});

afterAll(async () => {
  await server.close();
});

async function inviteCaregiver(parent: Account, role: 'caregiver' | 'parent') {
  const email = freshEmail('caregiver');
  const invite = await call(server, `/families/${parent.familyId}/invites`, {
    method: 'POST',
    token: parent.token,
    body: { email, role, displayName: 'Care Giver' },
  });
  expect(invite.status).toBe(201);
  const account = await register(server, 'Care Giver', email);
  const accepted = await call(server, '/invites/accept', {
    method: 'POST',
    token: account.token,
    body: { code: invite.body.invite.code },
  });
  expect(accepted.status).toBe(200);
  expect(accepted.body.family.role).toBe(role);
  return account;
}

describe('role based access control', () => {
  it('gives caregivers read access but blocks management actions', async () => {
    const caregiver = await inviteCaregiver(owner, 'caregiver');

    const devices = await listDevices(server, caregiver);
    expect(devices.some((d) => d.id === child.deviceId)).toBe(true);

    const pairing = await call(server, '/pairings', {
      method: 'POST',
      token: caregiver.token,
      body: { childName: 'Not Allowed', familyId: owner.familyId },
    });
    expect(pairing.status).toBe(403);

    const rename = await call(server, `/devices/${child.deviceId}`, {
      method: 'PATCH',
      token: caregiver.token,
      body: { name: 'Renamed by caregiver' },
    });
    expect(rename.status).toBe(403);
  });

  it('lets a parent invite but reserves role changes for the owner', async () => {
    const parent = await inviteCaregiver(owner, 'parent');

    const promoted = await call(server, `/families/${owner.familyId}/members`, { token: parent.token });
    expect(promoted.status).toBe(200);
    const caregiverMember = promoted.body.members.find((m: { role: string }) => m.role === 'caregiver');
    expect(caregiverMember).toBeTruthy();

    const change = await call(server, `/families/${owner.familyId}/members/${caregiverMember.id}`, {
      method: 'PATCH',
      token: parent.token,
      body: { role: 'parent' },
    });
    expect(change.status).toBe(403);

    const ownerChange = await call(server, `/families/${owner.familyId}/members/${caregiverMember.id}`, {
      method: 'PATCH',
      token: owner.token,
      body: { role: 'caregiver' },
    });
    expect(ownerChange.status).toBe(200);
  });

  it('keeps families isolated from each other', async () => {
    const outsider = await register(server, 'Outsider Parent');

    const deviceRead = await call(server, `/devices/${child.deviceId}`, { token: outsider.token });
    expect([403, 404]).toContain(deviceRead.status);

    const sessionAttempt = await call(server, `/devices/${child.deviceId}/sessions`, {
      method: 'POST',
      token: outsider.token,
      body: { kind: 'camera', reason: 'Not my device' },
    });
    expect([403, 404]).toContain(sessionAttempt.status);

    const auditAttempt = await call(server, `/families/${owner.familyId}/audit`, { token: outsider.token });
    expect(auditAttempt.status).toBe(403);
  });

  it('prevents changing the owner role and removing the owner', async () => {
    const members = await call(server, `/families/${owner.familyId}/members`, { token: owner.token });
    const ownerMember = members.body.members.find((m: { role: string }) => m.role === 'owner');

    const demote = await call(server, `/families/${owner.familyId}/members/${ownerMember.id}`, {
      method: 'PATCH',
      token: owner.token,
      body: { role: 'parent' },
    });
    expect(demote.status).toBe(403);

    const remove = await call(server, `/families/${owner.familyId}/members/${ownerMember.id}`, {
      method: 'DELETE',
      token: owner.token,
    });
    expect(remove.status).toBe(403);
  });
});
