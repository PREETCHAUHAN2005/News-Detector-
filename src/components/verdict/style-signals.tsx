"use client";
/** Secondary-signal panel (BR-07): style scores are DISPLAY-ONLY and clearly
    labelled as such — they never influence the verdict. */
import { Flame, HeartCrack, HelpCircle, MousePointerClick, ShieldAlert } from "lucide-react";
import { parseStyleSignals } from "@/types/api";

export function StyleSignalsPanel({ signals }: { signals: string | null | undefined }) {
  const parsed = parseStyleSignals(signals);
  if (!parsed) return null;

  const rows = [
    { key: "sensationalism", label: "Sensationalism", value: parsed.sensationalism, icon: Flame },
    { key: "emotional", label: "Emotional language", value: parsed.emotional, icon: HeartCrack },
    { key: "hedging", label: "Hedging / unsourced", value: parsed.hedging, icon: HelpCircle },
    { key: "clickbait", label: "Clickbait patterns", value: parsed.clickbait, icon: MousePointerClick },
  ];
  const maxNote = Math.max(...rows.map((r) => r.value));
  if (maxNote <= 0 && parsed.notes.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          <ShieldAlert className="size-3.5 text-amber-400/80" aria-hidden />
          Writing-style signals
        </h4>
        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300/90">
          Secondary — never used for the verdict
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {rows.map((row) => (
          <div key={row.key} className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span className="flex items-center gap-1">
                <row.icon className="size-3 text-zinc-500" aria-hidden />
                {row.label}
              </span>
              <span className="tabular-nums">{Math.round(row.value * 100)}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  row.value >= 0.5 ? "bg-amber-400" : row.value > 0 ? "bg-zinc-500" : "bg-transparent"
                }`}
                style={{ width: `${row.value * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      {parsed.notes.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-zinc-800/70 pt-2.5">
          {parsed.notes.slice(0, 4).map((note, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-400">
              <span className="mt-1 size-1 shrink-0 rounded-full bg-amber-400/70" aria-hidden />
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
