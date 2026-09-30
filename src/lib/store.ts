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
  setReviewPreset: (preset) => set({ reviewPreset: preset }),
}));
