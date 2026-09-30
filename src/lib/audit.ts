/**
 * Audit logging (BR-13): every state change is recorded, append-only.
 */
import { db } from "@/lib/db";

export async function audit(
  action: string,
  entityType: string,
  entityId: string,
  detail?: Record<string, unknown>,
  actorId?: string | null
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        actorId: actorId ?? undefined,
        detail: detail ? JSON.stringify(detail) : undefined,
      },
    });
  } catch (error) {
    // audit failures must never break the main flow, but they are logged
    console.error("audit-log-failure", { action, entityId, error });
  }
}
