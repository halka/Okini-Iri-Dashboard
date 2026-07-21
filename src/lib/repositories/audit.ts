import type { AuthUser } from "../../domain/auth";
import type { AuditAction, AuditLog } from "../../domain/audit";

type AuditEvent = {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  details?: Record<string, unknown>;
};

type AuditRow = {
  id: string;
  actor_subject: string;
  actor_name: string;
  actor_email: string | null;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  details_json: string;
  created_at: string;
};

const maxAuditLogs = 1_000;

export async function recordAuditLog(db: D1Database, user: AuthUser | undefined, event: AuditEvent) {
  const actor = user ?? {
    subject: "unknown",
    name: "Unknown actor",
    email: null
  };
  await db.batch([
    db
      .prepare(
        `INSERT INTO audit_logs
          (id, actor_subject, actor_name, actor_email, action, entity_type, entity_id, summary, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        crypto.randomUUID(),
        actor.subject,
        actor.name,
        actor.email,
        event.action,
        event.entityType,
        event.entityId ?? null,
        event.summary?.slice(0, 500) ?? "",
        JSON.stringify(event.details ?? {})
      ),
    db.prepare(
      `DELETE FROM audit_logs
       WHERE id NOT IN (
         SELECT id FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?
       )`
    ).bind(maxAuditLogs)
  ]);
}

export async function recordAuditLogSafely(db: D1Database, user: AuthUser | undefined, event: AuditEvent) {
  try {
    await recordAuditLog(db, user, event);
  } catch (error) {
    console.error("Could not write audit log", error);
  }
}

export async function listAuditLogs(db: D1Database, limit = 100): Promise<AuditLog[]> {
  const result = await db
    .prepare(
      `SELECT id, actor_subject, actor_name, actor_email, action, entity_type, entity_id, summary, details_json, created_at
       FROM audit_logs
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .bind(Math.min(Math.max(limit, 1), 200))
    .all<AuditRow>();

  return result.results.map((row) => ({
    id: row.id,
    actorSubject: row.actor_subject,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    details: parseDetails(row.details_json),
    createdAt: row.created_at
  }));
}

function parseDetails(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
