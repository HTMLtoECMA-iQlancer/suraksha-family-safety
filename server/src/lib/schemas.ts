import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like 21:00');
const email = z.string().trim().toLowerCase().email('Enter a valid email').max(254);
const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(200)
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number');

export const registerSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1, 'Tell us your name').max(80),
  phone: z.string().trim().max(30).optional().nullable(),
  locale: z.enum(['en', 'gu']).default('en'),
  acceptTerms: z.literal(true).optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(10).max(500) });

export const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(30).optional().nullable(),
  locale: z.enum(['en', 'gu']).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});

export const deleteAccountSchema = z.object({ password: z.string().min(1).max(200) });

export const pushTokenSchema = z.object({
  token: z.string().min(10).max(4096),
  platform: z.enum(['android', 'web', 'ios']),
});

export const createFamilySchema = z.object({ name: z.string().trim().min(1).max(80) });

export const inviteSchema = z.object({
  email,
  role: z.enum(['parent', 'caregiver']).default('caregiver'),
  displayName: z.string().trim().min(1).max(80).optional(),
});

export const acceptInviteSchema = z.object({ code: z.string().trim().min(4).max(64) });

export const roleSchema = z.object({ role: z.enum(['parent', 'caregiver']) });

export const pairingCreateSchema = z.object({
  childName: z.string().trim().min(1).max(60),
  familyId: z.string().uuid().optional(),
});

export const childPairSchema = z.object({
  code: z.string().trim().toUpperCase().length(6),
  childName: z.string().trim().min(1).max(60).optional(),
  model: z.string().trim().max(120).optional(),
  platform: z.enum(['android', 'web-preview', 'ios-preview']).default('android'),
  osVersion: z.string().trim().max(40).optional(),
  appVersion: z.string().trim().max(40).optional(),
});

export const devicePatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  childName: z.string().trim().min(1).max(60).optional(),
});

export const sessionCreateSchema = z.object({
  kind: z.enum(['camera', 'audio', 'screen']),
  reason: z.string().trim().max(160).default(''),
});

export const trustedAccessSchema = z.object({
  enabled: z.boolean(),
  confirmed: z.literal(true),
});

export const sessionRespondSchema = z.object({
  approve: z.boolean(),
  reason: z.string().trim().max(160).optional(),
});

export const sessionEndSchema = z.object({
  reason: z.string().trim().max(160).optional(),
});

export const screenTimeSchema = z.object({
  dailyLimitMinutes: z.number().int().min(0).max(1440),
  downtime: z.object({
    enabled: z.boolean(),
    start: hhmm,
    end: hhmm,
    days: z.array(z.number().int().min(0).max(6)).max(7),
  }),
  week: z
    .array(z.object({ day: z.number().int().min(0).max(6), limitMinutes: z.number().int().min(0).max(1440) }))
    .max(7)
    .default([]),
});

export const appRulesSchema = z.object({
  rules: z
    .array(
      z.object({
        package: z.string().trim().min(1).max(200),
        appName: z.string().trim().min(1).max(120),
        category: z.string().trim().max(40).default('Other'),
        blocked: z.boolean().default(false),
        limitMinutes: z.number().int().min(0).max(1440).nullable().default(null),
      }),
    )
    .max(500),
});

export const locationPolicySchema = z.object({
  sharingEnabled: z.boolean(),
  historyEnabled: z.boolean(),
  retentionDays: z.number().int().min(1).max(365),
  drivingAlerts: z.boolean(),
  sosEnabled: z.boolean(),
});

export const safeBrowsingSchema = z.object({
  enabled: z.boolean(),
  method: z.enum(['dns', 'vpn', 'browser-extension']),
  blockedCategories: z.array(z.string().trim().min(1).max(40)).max(30),
  allowList: z.array(z.string().trim().min(1).max(253)).max(500),
});

export const notificationPolicySchema = z.object({
  safetyAlerts: z.boolean(),
  sessionRequests: z.boolean(),
  dailyDigest: z.boolean(),
  quietHours: z.object({ enabled: z.boolean(), start: hhmm, end: hhmm }),
});

export const supervisionSchema = z.object({
  requireApprovalAlways: z.boolean(),
  childCanStopSessions: z.boolean(),
  shareSessionHistoryWithChild: z.boolean(),
});

export const instantBlockSchema = z.object({
  active: z.boolean(),
  until: z.string().datetime().nullable(),
});

export const policyPayloadSchemas = {
  screen_time: screenTimeSchema,
  app_rules: appRulesSchema,
  location: locationPolicySchema,
  safe_browsing: safeBrowsingSchema,
  notifications: notificationPolicySchema,
  supervision: supervisionSchema,
  instant_block: instantBlockSchema,
} as const;

export const focusLockSchema = z.object({ minutes: z.number().int().min(1).max(720) });

export const geofenceCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(50).max(5000),
  notifyOnEnter: z.boolean().default(true),
  notifyOnExit: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

export const geofenceUpdateSchema = geofenceCreateSchema.partial();

export const usageReportSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  entries: z
    .array(
      z.object({
        package: z.string().trim().min(1).max(200),
        appName: z.string().trim().min(1).max(120),
        category: z.string().trim().max(40).default('Other'),
        minutes: z.number().int().min(0).max(1440),
      }),
    )
    .max(500),
});

export const childPermissionsSchema = z.object({
  key: z.string().trim().min(1).max(60),
  granted: z.boolean(),
});

export const heartbeatSchema = z.object({
  battery: z.number().int().min(0).max(100).nullable().optional(),
  network: z.string().trim().max(40).nullable().optional(),
  appVersion: z.string().trim().max(40).optional(),
  permissionStatus: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        granted: z.boolean(),
        requiredFor: z.string().default(''),
        updatedAt: z.string().nullable().default(null),
      }),
    )
    .optional(),
});

export const childEventSchema = z.object({
  kind: z.enum([
    'content.alert',
    'browsing.blocked',
    'driving.speed',
    'system.notice',
    'permission.revoked',
    'usage.limit',
  ]),
  severity: z.enum(['info', 'warning', 'critical']).default('info'),
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().max(1000).default(''),
  metadata: z.record(z.unknown()).default({}),
});

export const locationReportSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).default(0),
  speed: z.number().min(0).max(2000).nullable().optional(),
  recordedAt: z.string().datetime().optional(),
});

export const unlinkSchema = z.object({ confirm: z.literal(true) });

export const demoChildSessionSchema = z.object({ deviceId: z.string().uuid() });

export const childTokenSchema = z.object({ refreshToken: z.string().min(10).max(500) });
