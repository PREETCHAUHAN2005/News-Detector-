"use client";
/** Veritas — single-route application shell (Cursor-style workbench). */
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Providers } from "@/components/providers";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { CommandPalette } from "@/components/command-palette";
import { KeyboardShortcuts } from "@/components/shortcuts-help";
import { GNav } from "@/components/g-nav";
import { PrecedentSearchDialog } from "@/components/precedent-search-dialog";
import { StatusBar } from "@/components/status-bar";
import { VeritasLogo } from "@/components/veritas-logo";
import { useAppStore } from "@/lib/store";
import { AUTH_LOGIN_ENABLED } from "@/lib/auth-mode";

// LOGIN FEATURE (disabled for this phase): the sign-in view renders only when
// AUTH_LOGIN_ENABLED is true. The workbench otherwise opens directly — a demo
// reviewer session is established automatically (see components/providers.tsx)
// and the API falls back to the same identity server-side (see lib/auth.ts).
// To bring the login screen back: set AUTH_LOGIN_ENABLED = true in auth-mode.ts.
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
  // While the automatic demo session is being established (a few hundred ms)
  // we hold the full-screen loader, so the user never sees an unauthenticated
  // shell or a login screen. A 4s escape hatch guarantees the workbench still
  // opens if the auto sign-in cannot complete (server fallback keeps the API up).
  const [sessionWaitExpired, setSessionWaitExpired] = useState(false);
  useEffect(() => {
    if (AUTH_LOGIN_ENABLED) return;
    const t = setTimeout(() => setSessionWaitExpired(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const waitingForAutoSession =
    !AUTH_LOGIN_ENABLED && status !== "authenticated" && !sessionWaitExpired;

  if (status === "loading" || waitingForAutoSession) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <VeritasLogo className="size-10" />
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Preparing your workbench…
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen max-h-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar — static on desktop (hidden when printing the dossier) */}
      <aside
        data-chrome="sidebar"
        className="hidden w-[264px] shrink-0 border-r border-zinc-800/80 lg:block"
        aria-label="Sidebar"
      >
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
        <PrecedentSearchDialog />
        <KeyboardShortcuts />
        <GNav />
      </div>
    </div>
  );
}

function SessionGate() {
  const { status, data: session } = useSession();
  const view = useAppStore((s) => s.view);

  // ── LOGIN FEATURE — commented out for this phase ──────────────────────
  // The interface must open WITHOUT any login screen. The sign-in view is
  // only reachable when AUTH_LOGIN_ENABLED is flipped back to true.
  if (AUTH_LOGIN_ENABLED && (status === "unauthenticated" || !session)) {
    return <SignInView />;
  }
  // ─────────────────────────────────────────────────────────────────────

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
