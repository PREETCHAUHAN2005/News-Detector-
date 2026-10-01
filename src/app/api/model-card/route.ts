/**
 * GET /api/model-card — engine model card + frozen-test release gates (BRD §11),
 * proxied server-side so the engine is never exposed to the browser directly.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { engineEval, engineModelCard } from "@/lib/nlp-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const [card, evalResult] = await Promise.all([engineModelCard(), engineEval()]);
    if (!card) {
      return NextResponse.json(
        {
          card: null,
          evalResult: null,
          unavailable: true,
          message: "NLP engine unavailable — fail-safe active. Analyses are filed as Unverified and routed to human review.",
        },
        { status: 200 }
      );
    }
    return NextResponse.json({ card, evalResult });
  } catch (error) {
    console.error("model-card-error", error);
    return NextResponse.json({ error: "Failed to load model card" }, { status: 500 });
  }
}
