import { randomUUID } from 'node:crypto';
import { ANDROID_PERMISSIONS, isoDayOffset } from '@suraksha/shared';
import type { Db } from './lib/db.js';
import { hashPassword } from './lib/crypto.js';
import { defaultPolicies, ensurePolicies, upsertPolicy } from './lib/defaults.js';

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * MIN).toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

function permissions(grantedKeys: string[], now: string) {
  return ANDROID_PERMISSIONS.map((p) => ({
    key: p.key,
    label: p.label,
    requiredFor: p.requiredFor,
    granted: grantedKeys.includes(p.key),
    updatedAt: now,
  }));
}

export async function seedDemo(db: Db): Promise<boolean> {
  const existing = await db.query<{ id: string }>("SELECT id FROM users WHERE email = 'demo@suraksha.app'");
  if (existing.length) return false;

  const parentId = randomUUID();
  const caregiverId = randomUUID();
  const familyId = randomUUID();
  const passwordHash = await hashPassword('Demo1234!');
  const nowIso = new Date().toISOString();

  await db.query(
    `INSERT INTO users (id, email, password_hash, display_name, locale, email_verified, created_at)
     VALUES ($1, 'demo@suraksha.app', $2, 'Meera Shah', 'en', true, $3)`,
    [parentId, passwordHash, daysAgo(60)],
  );
  await db.query(
    `INSERT INTO users (id, email, password_hash, display_name, locale, email_verified, created_at)
     VALUES ($1, 'nani@suraksha.app', $2, 'Nani Kamla', 'gu', true, $3)`,
    [caregiverId, passwordHash, daysAgo(45)],
  );
  await db.query(
    `INSERT INTO families (id, name, created_by, created_at) VALUES ($1, 'Shah Family', $2, $3)`,
    [familyId, parentId, daysAgo(60)],
  );
  await db.query(
    `INSERT INTO family_members (id, family_id, user_id, email, display_name, role, status, created_at, accepted_at)
     VALUES ($1, $2, $3, 'demo@suraksha.app', 'Meera Shah', 'owner', 'active', $4, $4)`,
    [randomUUID(), familyId, parentId, daysAgo(60)],
  );
  await db.query(
    `INSERT INTO family_members (id, family_id, user_id, email, display_name, role, status, created_at, accepted_at)
     VALUES ($1, $2, $3, 'nani@suraksha.app', 'Nani Kamla', 'caregiver', 'active', $4, $5)`,
    [randomUUID(), familyId, caregiverId, daysAgo(45), daysAgo(40)],
  );

  const aaravId = randomUUID();
  const diyaId = randomUUID();
  const linkedAt = daysAgo(45);

  await db.query(
    `INSERT INTO devices (id, family_id, child_name, name, model, platform, os_version, app_version, status, battery,
        network, last_seen_at, permission_status, linked_at, created_at)
     VALUES ($1, $2, 'Aarav', 'Aarav''s Phone', 'Pixel 8a', 'android', 'Android 15', '1.0.0', 'offline', 72,
        'Wi-Fi', $3, $4, $5, $5)`,
    [
      aaravId,
      familyId,
      ago(2),
      JSON.stringify(
        permissions(['camera', 'microphone', 'location', 'notifications', 'usage_access', 'screen_capture'], ago(30)),
      ),
      linkedAt,
    ],
  );
  await db.query(
    `INSERT INTO devices (id, family_id, child_name, name, model, platform, os_version, app_version, status, battery,
        network, last_seen_at, permission_status, linked_at, created_at)
     VALUES ($1, $2, 'Diya', 'Diya''s Tablet', 'Galaxy Tab A9', 'android', 'Android 14', '1.0.0', 'offline', 34,
        'Mobile data', $3, $4, $5, $5)`,
    [
      diyaId,
      familyId,
      ago(180),
      JSON.stringify(
        permissions(['camera', 'microphone', 'location', 'notifications', 'usage_access'], ago(90)),
      ),
      daysAgo(30),
    ],
  );

  await ensurePolicies(db, familyId, aaravId, parentId);
  await ensurePolicies(db, familyId, diyaId, parentId);

  const defaults = defaultPolicies();
  await upsertPolicy(
    db,
    familyId,
    aaravId,
    'screen_time',
    {
      dailyLimitMinutes: 180,
      downtime: { enabled: true, start: '21:00', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6] },
      week: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, limitMinutes: day === 0 || day === 6 ? 240 : 180 })),
    },
    parentId,
  );
  await upsertPolicy(
    db,
    familyId,
    diyaId,
    'screen_time',
    {
      dailyLimitMinutes: 120,
      downtime: { enabled: true, start: '20:30', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6] },
      week: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, limitMinutes: 120 })),
    },
    parentId,
  );
  await upsertPolicy(
    db,
    familyId,
    aaravId,
    'app_rules',
    {
      rules: [
        { package: 'com.google.android.youtube', appName: 'YouTube', category: 'Video', blocked: false, limitMinutes: 60 },
        { package: 'com.instagram.android', appName: 'Instagram', category: 'Social', blocked: false, limitMinutes: 30 },
        { package: 'com.mojang.minecraftpe', appName: 'Minecraft', category: 'Games', blocked: false, limitMinutes: 45 },
      ],
    },
    parentId,
  );
  await upsertPolicy(
    db,
    familyId,
    aaravId,
    'safe_browsing',
    { enabled: true, method: 'dns', blockedCategories: ['adult', 'gambling', 'violence'], allowList: ['school.edu.in'] },
    parentId,
  );
  await upsertPolicy(
    db,
    familyId,
    diyaId,
    'location',
    { ...defaults.location, retentionDays: 14 },
    parentId,
  );

  for (const deviceId of [aaravId, diyaId]) {
    await db.query(
      `INSERT INTO consent_records (id, family_id, device_id, kind, text_version, granted, created_at)
       VALUES ($1, $2, $3, 'child_transparency', '2026-11-01', true, $4)`,
      [randomUUID(), familyId, deviceId, linkedAt],
    );
    await db.query(
      `INSERT INTO consent_records (id, family_id, device_id, user_id, kind, text_version, granted, created_at)
       VALUES ($1, $2, $3, $4, 'parent_pairing_approval', '2026-11-01', true, $5)`,
      [randomUUID(), familyId, deviceId, parentId, linkedAt],
    );
  }

  const geofences = [
    { name: 'Home', lat: 23.0301, lng: 72.58, radius: 250, device: aaravId },
    { name: 'School', lat: 23.0395, lng: 72.545, radius: 300, device: aaravId },
    { name: 'Home', lat: 23.0301, lng: 72.58, radius: 250, device: diyaId },
  ];
  for (const g of geofences) {
    await db.query(
      `INSERT INTO geofences (id, family_id, device_id, name, lat, lng, radius_m, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), familyId, g.device, g.name, g.lat, g.lng, g.radius, daysAgo(20)],
    );
  }

  const aaravApps = [
    { pkg: 'com.google.android.youtube', name: 'YouTube', category: 'Video', base: 42 },
    { pkg: 'com.whatsapp', name: 'WhatsApp', category: 'Messaging', base: 26 },
    { pkg: 'com.instagram.android', name: 'Instagram', category: 'Social', base: 18 },
    { pkg: 'com.mojang.minecraftpe', name: 'Minecraft', category: 'Games', base: 22 },
    { pkg: 'com.duolingo', name: 'Duolingo', category: 'Education', base: 14 },
    { pkg: 'com.android.chrome', name: 'Chrome', category: 'Utilities', base: 15 },
    { pkg: 'com.google.android.gm', name: 'Gmail', category: 'Productivity', base: 5 },
  ];
  const diyaApps = [
    { pkg: 'com.google.android.apps.youtubekids', name: 'YouTube Kids', category: 'Video', base: 38 },
    { pkg: 'com.whatsapp', name: 'WhatsApp', category: 'Messaging', base: 12 },
    { pkg: 'com.duolingo', name: 'Duolingo', category: 'Education', base: 20 },
    { pkg: 'com.android.chrome', name: 'Chrome', category: 'Utilities', base: 6 },
  ];
  for (let dayIndex = 0; dayIndex < 14; dayIndex += 1) {
    const day = isoDayOffset(dayIndex);
    for (const [appIndex, app] of aaravApps.entries()) {
      const wobble = ((dayIndex * 5 + appIndex * 11) % 19) - 9;
      const minutes = dayIndex === 0 ? app.base : Math.max(2, app.base + wobble);
      await db.query(
        `INSERT INTO app_usage_daily (id, family_id, device_id, day, package, app_name, category, minutes, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [randomUUID(), familyId, aaravId, day, app.pkg, app.name, app.category, minutes],
      );
    }
    for (const [appIndex, app] of diyaApps.entries()) {
      const wobble = ((dayIndex * 3 + appIndex * 7) % 11) - 5;
      const minutes = Math.max(2, app.base + wobble);
      await db.query(
        `INSERT INTO app_usage_daily (id, family_id, device_id, day, package, app_name, category, minutes, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [randomUUID(), familyId, diyaId, day, app.pkg, app.name, app.category, minutes],
      );
    }
  }

  const locationPoints = [
    { lat: 23.0301, lng: 72.58, minutes: 170 },
    { lat: 23.0322, lng: 72.5721, minutes: 130 },
    { lat: 23.0351, lng: 72.5617, minutes: 90 },
    { lat: 23.0377, lng: 72.5522, minutes: 50 },
    { lat: 23.0395, lng: 72.545, minutes: 18 },
    { lat: 23.0394, lng: 72.5452, minutes: 6 },
  ];
  for (const point of locationPoints) {
    await db.query(
      `INSERT INTO locations (id, family_id, device_id, lat, lng, accuracy, speed, recorded_at)
       VALUES ($1, $2, $3, $4, $5, 12, 0, $6)`,
      [randomUUID(), familyId, aaravId, point.lat, point.lng, ago(point.minutes)],
    );
  }
  await db.query(
    `INSERT INTO locations (id, family_id, device_id, lat, lng, accuracy, speed, recorded_at)
     VALUES ($1, $2, $3, 23.0302, 72.5802, 20, 0, $4)`,
    [randomUUID(), familyId, diyaId, ago(180)],
  );

  const events = [
    {
      device: aaravId,
      kind: 'device.online',
      severity: 'info',
      title: "Aarav's Phone came online",
      detail: 'Device connected to Wi-Fi',
      at: ago(12),
      meta: {},
    },
    {
      device: aaravId,
      kind: 'geofence.exit',
      severity: 'info',
      title: 'Aarav left School',
      detail: 'Location alert from Aarav\'s Phone',
      at: ago(45),
      meta: { lat: 23.0402, lng: 72.5481 },
    },
    {
      device: aaravId,
      kind: 'content.alert',
      severity: 'warning',
      title: 'Possible risky content flagged',
      detail: 'A conversation in a third-party app was flagged for review. Talk with Aarav together.',
      at: ago(120),
      meta: { confidence: 0.72, demo: true },
    },
    {
      device: aaravId,
      kind: 'browsing.blocked',
      severity: 'warning',
      title: 'Blocked website attempt',
      detail: 'Safe Browsing blocked an adult-category site in Chrome.',
      at: ago(190),
      meta: { category: 'adult', domain: 'blocked.example' },
    },
    {
      device: aaravId,
      kind: 'session.ended',
      severity: 'info',
      title: 'Camera session ended',
      detail: 'Aarav stopped the camera session from his phone',
      at: ago(300),
      meta: { sessionKind: 'camera', by: 'child' },
    },
    {
      device: aaravId,
      kind: 'usage.limit',
      severity: 'warning',
      title: 'Daily screen-time limit reached',
      detail: 'Aarav reached the 180 minute daily limit yesterday',
      at: ago(26 * 60),
      meta: { minutes: 186 },
    },
    {
      device: diyaId,
      kind: 'geofence.enter',
      severity: 'info',
      title: 'Diya arrived at Home',
      detail: 'Location alert from Diya\'s Tablet',
      at: ago(320),
      meta: { lat: 23.0301, lng: 72.58 },
    },
    {
      device: diyaId,
      kind: 'device.offline',
      severity: 'info',
      title: "Diya's Tablet went offline",
      detail: 'Last seen 3 hours ago on mobile data',
      at: ago(180),
      meta: {},
    },
  ];
  for (const e of events) {
    await db.query(
      `INSERT INTO safety_events (id, family_id, device_id, kind, severity, title, detail, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), familyId, e.device, e.kind, e.severity, e.title, e.detail, JSON.stringify(e.meta), e.at],
    );
  }

  const cameraSessionId = randomUUID();
  await db.query(
    `INSERT INTO session_requests (id, family_id, device_id, parent_user_id, parent_name, kind, status, reason,
        created_at, responded_at, started_at, ended_at, ended_by)
     VALUES ($1, $2, $3, $4, 'Meera Shah', 'camera', 'ended', 'Checking the homework desk setup', $5, $6, $7, $8, 'child')`,
    [cameraSessionId, familyId, aaravId, parentId, ago(302), ago(301), ago(300), ago(285)],
  );
  const deniedSessionId = randomUUID();
  await db.query(
    `INSERT INTO session_requests (id, family_id, device_id, parent_user_id, parent_name, kind, status, reason,
        created_at, responded_at, ended_at, ended_by)
     VALUES ($1, $2, $3, $4, 'Meera Shah', 'screen', 'denied', 'Quick check of a school portal', $5, $6, $6, 'child')`,
    [deniedSessionId, familyId, aaravId, parentId, ago(26 * 60), ago(26 * 60 - 1)],
  );
  const expiredSessionId = randomUUID();
  await db.query(
    `INSERT INTO session_requests (id, family_id, device_id, parent_user_id, parent_name, kind, status, reason,
        created_at, responded_at, ended_at, ended_by)
     VALUES ($1, $2, $3, $4, 'Meera Shah', 'audio', 'expired', 'Could not reach Aarav', $5, $6, $6, 'system')`,
    [expiredSessionId, familyId, aaravId, parentId, daysAgo(2), daysAgo(2)],
  );

  const audits = [
    ["parent", parentId, "device.linked", { deviceId: aaravId }, daysAgo(45)],
    ["child", aaravId, "pairing.child_confirmed", {}, daysAgo(45)],
    ["parent", parentId, "policy.updated.screen_time", {}, ago(24 * 60)],
    ["parent", parentId, "session.requested", { sessionId: cameraSessionId }, ago(302)],
    ["child", aaravId, "session.approved", { sessionId: cameraSessionId }, ago(301)],
    ["child", aaravId, "session.ended", { sessionId: cameraSessionId, by: "child" }, ago(285)],
    ["parent", parentId, "session.requested", { sessionId: deniedSessionId }, ago(26 * 60)],
    ["child", aaravId, "session.denied", { sessionId: deniedSessionId }, ago(26 * 60 - 1)],
    ["parent", parentId, "geofence.created", { name: "Home" }, daysAgo(20)],
    ["parent", parentId, "device.unlinked", {}, daysAgo(2)],
  ] as const;
  for (const [actorType, actorId, action, meta, createdAt] of audits) {
    await db.query(
      `INSERT INTO audit_logs (id, family_id, device_id, session_id, actor_type, actor_id, action, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        randomUUID(),
        familyId,
        aaravId,
        (meta as Record<string, string>).sessionId ?? null,
        actorType,
        actorId,
        action,
        JSON.stringify(meta),
        createdAt,
      ],
    );
  }

  console.log(`[suraksha] Demo family seeded at ${nowIso}`);
  return true;
}
