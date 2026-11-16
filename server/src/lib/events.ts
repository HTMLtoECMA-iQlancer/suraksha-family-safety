import { randomUUID } from 'node:crypto';
import type { EventSeverity, SafetyEvent, SafetyEventKind } from '@suraksha/shared';
import type { Db } from './db.js';
import type { Hub } from '../realtime.js';
import { toEvent } from './models.js';
import type { EventRow } from './models.js';

export interface AuditInput {
  familyId: string;
  deviceId?: string | null;
  sessionId?: string | null;
  actorType: 'parent' | 'child' | 'system' | 'device';
  actorId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(db: Db, input: AuditInput): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (id, family_id, device_id, session_id, actor_type, actor_id, action, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      input.familyId,
      input.deviceId ?? null,
      input.sessionId ?? null,
      input.actorType,
      input.actorId ?? null,
      input.action,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export interface RecordEventInput {
  familyId: string;
  deviceId: string;
  kind: SafetyEventKind;
  severity: EventSeverity;
  title: string;
  detail?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

export async function recordEvent(db: Db, hub: Hub | null, input: RecordEventInput): Promise<SafetyEvent> {
  const rows = await db.query<EventRow>(
    `INSERT INTO safety_events (id, family_id, device_id, kind, severity, title, detail, metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      randomUUID(),
      input.familyId,
      input.deviceId,
      input.kind,
      input.severity,
      input.title,
      input.detail ?? '',
      JSON.stringify(input.metadata ?? {}),
      input.occurredAt ?? new Date().toISOString(),
    ],
  );
  const event = toEvent(rows[0]);
  hub?.broadcastToFamily(event.familyId, { type: 'event.new', data: { event } });
  return event;
}
