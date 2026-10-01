"use client";
/** Calibrated confidence gauge with the abstention band made visible.
    Confidence is honest: values below the class threshold mean the model
    abstained — the gauge shows exactly where a reading fell. */
import { useMemo } from "react";

const THRESHOLDS: Record<string, number> = {
  Supported: 0.6,
  Misleading: 0.55,
  Contradicted: 0.7,
};

/** Labels without a decision bar (Unverified, NotAssessable) route to humans. */
function thresholdFor(label?: string | null): number | null {
  if (!label) return null;
  const t = THRESHOLDS[label];
  return typeof t === "number" ? t : null;
}

export function ConfidenceGauge({
  confidence,
  label,
  abstained,
  size = 140,
}: {
  confidence: number | null;
  label?: string | null;
  abstained?: boolean;
  size?: number;
}) {
  const value = typeof confidence === "number" ? Math.max(0, Math.min(1, confidence)) : 0;
  const threshold = thresholdFor(label);
  const hasBar = threshold !== null;
  const effectiveBar = threshold ?? 0.6; // only used for colour bucketing

  const { color, track, stroke } = useMemo(() => {
    if (abstained || !hasBar || value < effectiveBar) {
      return { color: "#a1a1aa", track: "#3f3f46", stroke: 8 }; // zinc — abstained
    }
    if (value >= 0.8) return { color: "#34d399", track: "#064e3b", stroke: 8 }; // emerald
    if (value >= 0.65) return { color: "#fbbf24", track: "#78350f", stroke: 8 }; // amber
    return { color: "#fbbf24", track: "#78350f", stroke: 8 };
  }, [value, effectiveBar, hasBar, abstained]);

  const r = 50;
  const circumference = Math.PI * r; // half circle
  const arc = (value * circumference).toFixed(2);
  const thresholdX = 60 + r * Math.cos(Math.PI * (1 - effectiveBar));

  return (
    <div className="flex flex-col items-center gap-1.5" role="img"
      aria-label={`Calibrated confidence ${Math.round(value * 100)} percent${abstained ? ", below threshold — abstained" : ""}`}>
      <svg viewBox="0 0 120 66" width={size} height={(size / 120) * 66}>
        {/* track */}
        <path
          d="M 10 60 A 50 50 0 0 1 110 60"
          fill="none"
          stroke={track}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* threshold marker — only for verdicts that have a decision bar */}
        {hasBar && (
          <line
            x1={thresholdX}
            y1={60 - Math.sqrt(Math.max(0, r * r - (thresholdX - 60) ** 2))}
            x2={thresholdX}
            y2={60 - Math.sqrt(Math.max(0, (r - 10) ** 2 - (thresholdX - 60) ** 2))}
            stroke="#f87171"
            strokeWidth={1.5}
            strokeDasharray="2 2"
          />
        )}
        {/* value arc */}
        <path
          d="M 10 60 A 50 50 0 0 1 110 60"
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
          className="transition-all duration-700 ease-out"
        />
        <text x="60" y="50" textAnchor="middle" className="fill-zinc-100 font-semibold" fontSize="17">
          {confidence === null ? "—" : `${Math.round(value * 100)}%`}
        </text>
        <text x="60" y="62" textAnchor="middle" className="fill-zinc-500" fontSize="7">
          {abstained ? "ABSTAINED" : "CALIBRATED CONFIDENCE"}
        </text>
      </svg>
      <p className="text-[11px] text-zinc-500">
        {abstained
          ? hasBar
            ? `Below the ${Math.round(effectiveBar * 100)}% safety bar for "${label ?? "this verdict"}"`
            : "Abstained by design — no evidence bar met; routed for human review"
          : hasBar
            ? `Above the ${Math.round(effectiveBar * 100)}% bar for "${label ?? "this verdict"}"`
            : "Routed for human review — no automated decision bar applies"}
      </p>
    </div>
  );
}

/** Compact inline confidence bar (for lists). */
export function ConfidenceBar({ confidence, label, abstained }: { confidence: number | null; label?: string | null; abstained?: boolean }) {
  const value = typeof confidence === "number" ? Math.max(0, Math.min(1, confidence)) : 0;
  const threshold = thresholdFor(label);
  const hasBar = threshold !== null;
  const effectiveBar = threshold ?? 0.6;
  const below = abstained || !hasBar || value < effectiveBar;
  const color = below ? "bg-zinc-500" : value >= 0.8 ? "bg-emerald-400" : "bg-amber-400";
  return (
    <div
      className="flex items-center gap-2"
      title={`Confidence ${Math.round(value * 100)}%${hasBar ? ` (threshold ${Math.round(effectiveBar * 100)}%)` : " — human review"}`}
    >
      <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
        <div className={cnBar(color)} style={{ width: `${value * 100}%` }} />
        {hasBar && (
          <div className="absolute inset-y-0 border-l border-dashed border-rose-500/70" style={{ left: `${effectiveBar * 100}%` }} />
        )}
      </div>
      <span className="text-[11px] tabular-nums text-zinc-500">{Math.round(value * 100)}%</span>
    </div>
  );
}

function cnBar(cls: string) {
  return `h-full rounded-full ${cls} transition-all duration-500`;
}
