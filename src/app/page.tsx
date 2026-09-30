"use client";
/** Veritas — single-route application shell (Cursor-style workbench). */
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Providers } from "@/components/providers";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { CommandPalette } from "@/components/command-palette";
import { KeyboardShortcuts } from "@/components/shortcuts-help";
import { StatusBar } from "@/components/status-bar";
import { VeritasLogo } from "@/components/veritas-logo";
import { useAppStore } from "@/lib/store";

import { SignInView } from "@/components/views/signin-view";
import { HomeView } from "@/components/views/home-view";
import { AnalysisView } from "@/components/views/analysis-view";
import { ReviewView } from "@/components/views/review-view";
import { AnalyticsView } from "@/components/views/analytics-view";
import { AppealsView } from "@/components/views/appeals-view";
import { AuditView } from "@/components/views/audit-view";
import { SourcesView } from "@/components/views/sources-view";
import { ModelCardView } from "@/components/views/model-card-view";

const VIEW_TITLES: Record<string, string> = {
  home: "Analyze a claim",
  analysis: "Analysis dossier",
  review: "Review queue",
  analytics: "Operations analytics",
  appeals: "Appeals",
  audit: "Audit log",
  sources: "Trusted-source registry",
  "model-card": "Model card & release gates",
};

export default function Page() {
  return (
    <Providers>
      <VeritasApp />
    </Providers>
  );
}

function VeritasApp() {
  const { status } = useSession();
  const view = useAppStore((s) => s.view);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <VeritasLogo className="size-10" />
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading your workbench…
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen max-h-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar — static on desktop */}
      <aside className="hidden w-[264px] shrink-0 border-r border-zinc-800/80 lg:block" aria-label="Sidebar">
        <AppSidebar />
      </aside>

      {/* Main column: topbar + view + status bar (sticky footer) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar title={VIEW_TITLES[view] ?? "Veritas"} />
        <main className="min-h-0 flex-1 overflow-y-auto" id="main-content">
          {/* subtle cross-fade between workbench views */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="min-h-full"
            >
              <SessionGate />
            </motion.div>
          </AnimatePresence>
        </main>
        <StatusBar />
        <CommandPalette />
        <KeyboardShortcuts />
      </div>
    </div>
  );
}

function SessionGate() {
  const { status, data: session } = useSession();
  const view = useAppStore((s) => s.view);

  if (status === "unauthenticated" || !session) {
    return <SignInView />;
  }

  switch (view) {
    case "analysis":
      return <AnalysisView />;
    case "review":
      return <ReviewView />;
    case "analytics":
      return <AnalyticsView />;
    case "appeals":
      return <AppealsView />;
    case "audit":
      return <AuditView />;
    case "sources":
      return <SourcesView />;
    case "model-card":
      return <ModelCardView />;
    default:
      return <HomeView />;
  }
}
