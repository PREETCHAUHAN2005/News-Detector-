/** Client-side view state (single-route app shell). */
import { create } from "zustand";

export type ViewId =
  | "home"
  | "analysis"
  | "review"
  | "analytics"
  | "appeals"
  | "audit"
  | "sources"
  | "model-card";

/** Pre-applied review-queue filters for cross-view drills (analytics KPI → queue). */
export interface ReviewPreset {
  status?: string;
  label?: string;
  /** fairness drill hand-off (BR-17): exact topic filter */
  topic?: string;
  /** auto-stamped — presets stay re-appliable for a short window so the
   *  framer-motion view transition (which briefly remounts the entering
   *  view) can't swallow them; they expire for genuine later visits. */
  at?: number;
}

interface AppState {
  view: ViewId;
  activeAnalysisId: string | null;
  setView: (view: ViewId) => void;
  openAnalysis: (id: string) => void;
  /** fired after a successful analyze run, so Home can celebrate */
  lastAnalyzedAt: number | null;
  markAnalyzed: () => void;
  /** ⌘K command palette visibility (topbar button + keyboard shortcut) */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** keyboard shortcuts cheatsheet visibility ("?" key + topbar button) */
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  /** one-shot review-queue filter preset; consumed (cleared) on queue mount */
  reviewPreset: ReviewPreset | null;
  setReviewPreset: (preset: ReviewPreset | null) => void;
  /** precedent search dialog (palette action + g p hotkey + composer link) */
  precedentSearchOpen: boolean;
  setPrecedentSearchOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "home",
  activeAnalysisId: null,
  setView: (view) => set({ view }),
  openAnalysis: (id) => set({ view: "analysis", activeAnalysisId: id }),
  lastAnalyzedAt: null,
  markAnalyzed: () => set({ lastAnalyzedAt: Date.now() }),
  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  shortcutsOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  reviewPreset: null,
  setReviewPreset: (preset) =>
    set({ reviewPreset: preset ? { ...preset, at: Date.now() } : null }),
  precedentSearchOpen: false,
  setPrecedentSearchOpen: (open) => set({ precedentSearchOpen: open }),
}));
