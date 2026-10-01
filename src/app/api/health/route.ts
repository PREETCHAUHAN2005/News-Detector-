/**
 * GET /api/health — app + engine health for ops (BR-16 error rates / availability).
 *
 * The status bar polls this every 30s, which doubles as a heartbeat that
 * re-spawns the NLP engine whenever the sandbox has reaped it (the Next.js
 * process supervises the engine — see nlp-client.ts SUPERVISION note).
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { engineHealth, ensureEngine } from "@/lib/nlp-client";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbOk = false;
  try {
    await db.auditLog.count();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  await ensureEngine(); // heartbeat: bring the engine back if it was reaped
  const engine = await engineHealth();
  return NextResponse.json({
    status: dbOk && engine.ok ? "ok" : "degraded",
    database: dbOk ? "ok" : "down",
    nlpEngine: engine.ok ? "ok" : "down",
    timestamp: new Date().toISOString(),
  });
}
