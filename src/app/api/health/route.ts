/**
 * GET /api/health — app + engine health for ops (BR-16 error rates / availability).
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { engineHealth } from "@/lib/nlp-client";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbOk = false;
  try {
    await db.auditLog.count();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const engine = await engineHealth();
  return NextResponse.json({
    status: dbOk && engine.ok ? "ok" : "degraded",
    database: dbOk ? "ok" : "down",
    nlpEngine: engine.ok ? "ok" : "down",
    timestamp: new Date().toISOString(),
  });
}
