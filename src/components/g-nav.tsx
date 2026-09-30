"use client";
/**
 * GNav — Gmail-style "g then <key>" view navigation.
 * Press "g" anywhere (outside a text field), then within 1.2s press one of
 * the view keys to jump directly. A small floating chip shows the pending
 * "g…" state; Escape or an unknown key cancels it.
 */
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { useAppStore, type ViewId } from "@/lib/store";

/** second key → view (g-prefix) */
const G_KEYS: Record<string, { view: ViewId; label: string }> = {
  h: { view: "home", label: "Analyze" },
  r: { view: "review", label: "Review queue" },
  a: { view: "analytics", label: "Analytics" },
  e: { view: "appeals", label: "Appeals" },
  u: { view: "audit", label: "Audit log" },
  s: { view: "sources", label: "Sources" },
  m: { view: "model-card", label: "Model card" },
};

const PENDING_MS = 1200;

/** true when the event target is a text-entry context (ignore shortcuts there) */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  );
}

export function GNav() {
  const { status } = useSession();
  const setView = useAppStore((s) => s.setView);
  const [pending, setPending] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authenticated = status === "authenticated";

  useEffect(() => {
    if (!authenticated) return;

    const clearPending = () => {
      setPending(false);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const showHint = (label: string) => {
      setHint(label);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(null), 1600);
    };

    const onKey = (event: KeyboardEvent) => {
      // never intercept modified keys (browser/OS shortcuts) or typing contexts
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (pending) {
        // any second key resolves the sequence
        event.preventDefault();
        const key = event.key.toLowerCase();
        const target = G_KEYS[key];
        clearPending();
        if (target) {
          setView(target.view);
          showHint(target.label);
        }
        return;
      }

      if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        setPending(true);
        timer.current = setTimeout(clearPending, PENDING_MS);
      } else if (event.key === "Escape") {
        clearPending();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer.current) clearTimeout(timer.current);
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, [authenticated, pending, setView]);

  if (!authenticated) return null;

  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-14 left-1/2 z-[90] -translate-x-1/2">
      <AnimatePresence>
        {pending && (
          <motion.span
            key="pending"
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="veritas-surface flex items-center gap-2 rounded-full border border-emerald-500/40 bg-zinc-900/95 px-3.5 py-1.5 text-[12px] text-zinc-200 shadow-xl shadow-black/40 backdrop-blur"
          >
            <kbd className="veritas-kbd">g</kbd>
            <span className="text-zinc-500">then</span>
            <span className="font-mono text-[11px] text-zinc-400">h r a e u s m</span>
          </motion.span>
        )}
        {hint && !pending && (
          <motion.span
            key={hint}
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="veritas-surface flex items-center gap-2 rounded-full border border-emerald-500/40 bg-zinc-900/95 px-3.5 py-1.5 text-[12px] font-medium text-emerald-300 shadow-xl shadow-black/40 backdrop-blur"
          >
            <ArrowUpRight className="size-3.5" aria-hidden />
            {hint}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
