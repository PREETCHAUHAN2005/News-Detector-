/**
 * /api/sources — trusted-source registry (BR-03, BR-07).
 * GET: list. POST (admin): add or update.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const upsertSchema = z.object({
  name: z.string().min(2).max(120),
  domain: z.string().min(3).max(200),
  category: z.enum(["fact_check", "wire_service", "official_records", "news"]),
  reliabilityScore: z.number().min(0).max(1),
  notes: z.string().max(1000).optional(),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const sources = await db.trustedSource.findMany({ orderBy: { reliabilityScore: "desc" } });
    return NextResponse.json({ sources });
  } catch (error) {
    console.error("sources-error", error);
    return NextResponse.json({ error: "Failed to list sources" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as { id?: string; role?: string } | undefined;
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Administrator role required" }, { status: 403 });
    }

    const parsed = upsertSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { name, domain, category, reliabilityScore, notes } = parsed.data;

    const source = await db.trustedSource.upsert({
      where: { name },
      create: { name, domain, category, reliabilityScore, notes },
      update: { domain, category, reliabilityScore, notes, approved: true },
    });

    await audit(
      "source_updated",
      "trusted_source",
      source.id,
      { name, domain, category, reliabilityScore, approved: source.approved },
      user.id
    );
    return NextResponse.json({ source });
  } catch (error) {
    console.error("source-upsert-error", error);
    return NextResponse.json({ error: "Failed to update source registry" }, { status: 500 });
  }
}
