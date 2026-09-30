"use client";
/** IDE-style status bar — the sticky footer of the app shell. */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Database, Radio } from "lucide-react";
import { useSession } from "next-auth/react";
import { fetchHealth } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export function StatusBar() {
  const { data: session } = useSession();
  const view = useAppStore((s) => s.view);
  const [clock, setClock] = useState("");

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const engineOk = health?.nlpEngine === "ok";
  const dbOk = health?.database === "ok";

  return (
    <footer
      className="flex h-8 shrink-0 items-center justify-between gap-4 border-t border-zinc-800/80 bg-zinc-950/95 px-3 text-[11px] text-zinc-500"
      role="contentinfo"
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="flex shrink-0 items-center gap-1.5" title="NLP engine status">
          <Radio
            className={`size-3 ${engineOk ? "text-emerald-400 veritas-pulse" : "text-rose-400"}`}
            aria-hidden
          />
          <span className="hidden sm:inline">Engine {engineOk ? "online" : "offline (fail-safe)"}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-1.5 sm:flex" title="Database status">
          <Database className={`size-3 ${dbOk ? "text-emerald-400" : "text-rose-400"}`} aria-hidden />
          DB {dbOk ? "ok" : "down"}
        </span>
        <span className="hidden shrink-0 items-center gap-1.5 lg:flex" title="Current view">
          <Activity className="size-3 text-zinc-400" aria-hidden />
          {view}
        </span>
        <span
          className="hidden min-w-0 flex-1 truncate text-zinc-600 xl:inline"
          title="Veritas never labels content automatically — a reviewer confirms every verdict."
        >
          Veritas never labels content automatically — a reviewer confirms every verdict.
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden font-mono text-zinc-600 sm:inline">v1.0.0</span>
        <span className="hidden text-zinc-500 md:inline">{session?.user?.name}</span>
        <span className="font-mono tabular-nums">{clock}</span>
      </div>
    </footer>
  );
}
