/**
 * POST /api/segment — live claim detection for the composer (advisory).
 *
 * Runs the engine's claim extraction (sanitize + split into checkable
 * claims — the same deterministic segmentation /v1/analyze and the precedent
 * search use) WITHOUT retrieving evidence or issuing any verdict. The composer
 * shows "N claims detected · M checkable" as the user types so multi-claim
 * pastes are legible before submission.
 *
 * Fail-safe: engine unreachable → empty claim list (the hint stays quiet);
 * nothing is persisted and no verdict is ever produced here.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { engineSegment } from "@/lib/nlp-client";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** below this the splitter is mostly noise ("The sky is…") */
const MIN_TEXT = 20;
const MAX_TEXT = 2000;
const MAX_CLAIMS = 12;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // debounced typing ⇒ generous capacity, still abuse-resistant (BRD §8)
    const limit = rateLimit(`segment:${clientIp(req)}`, 30, 30);
    if (!limit.ok) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = (await req.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
    if (text.length < MIN_TEXT) {
      return NextResponse.json({ claims: [], total: 0, assessable: 0 });
    }

    const claims = (await engineSegment(text)).slice(0, MAX_CLAIMS);
    return NextResponse.json({
      claims,
      total: claims.length,
      assessable: claims.filter((c) => c.assessable).length,
    });
  } catch (error) {
    console.error("segment-error", error);
    // silent degradation — the composer hint is advisory only
    return NextResponse.json({ claims: [], total: 0, assessable: 0 });
  }
}
