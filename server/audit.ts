import { db } from "./db";
import { auditLog } from "@shared/schema";
import { lt } from "drizzle-orm";

interface LogActionParams {
  userId?: string | null;
  username?: string | null;
  action: string;
  entityType?: string;
  entityId?: string | number;
  sceneId?: number;
  details?: Record<string, unknown>;
}

export function logAction(params: LogActionParams): void {
  db.insert(auditLog)
    .values({
      userId: params.userId || null,
      username: params.username || null,
      action: params.action,
      entityType: params.entityType || null,
      entityId: params.entityId != null ? String(params.entityId) : null,
      sceneId: params.sceneId || null,
      details: params.details || null,
    })
    .then(() => {})
    .catch((err) => {
      console.error("[Audit] Failed to log action:", err.message);
    });
}

export function startAuditCleanup(): void {
  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;
  const RETENTION_DAYS = 90;

  async function cleanup() {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
      const result = await db.delete(auditLog).where(lt(auditLog.createdAt, cutoff));
      console.log(`[Audit] Cleanup completed, removed old entries`);
    } catch (err: any) {
      console.error("[Audit] Cleanup error:", err.message);
    }
  }

  cleanup();
  setInterval(cleanup, CLEANUP_INTERVAL);
}
