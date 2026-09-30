"use client";
/** Top bar — Cursor-style context selectors + user menu. */
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, LogOut, Menu, Search, Settings2, ShieldAlert } from "lucide-react";
import { fetchModelCard } from "@/lib/api";
import { ROLE_DISPLAY } from "@/lib/taxonomy";
import { useAppStore } from "@/lib/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AppSidebar } from "@/components/app-sidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { VeritasLogo } from "@/components/veritas-logo";

export function AppTopbar({ title }: { title: string }) {
  const { data: session, status } = useSession();
  const [mobileNav, setMobileNav] = useState(false);
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);
  const authenticated = status === "authenticated";
  const { data: cardData } = useQuery({
    queryKey: ["model-card"],
    queryFn: fetchModelCard,
    staleTime: 5 * 60_000,
    retry: false,
    // The badge needs an authenticated /api/model-card call — only fetch once
    // signed in, otherwise the 401 error state would stick ("engine offline").
    enabled: status === "authenticated",
  });
  const modelVersion =
    (cardData?.card as { modelVersion?: string } | null)?.modelVersion ?? null;
  const user = session?.user as { name?: string | null; email?: string | null; role?: string } | undefined;
  const initials = (user?.name ?? "U")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-zinc-800/80 bg-zinc-950/80 px-3 backdrop-blur">
      {/* left: mobile nav + breadcrumb */}
      <div className="flex min-w-0 items-center gap-2">
        <Sheet open={mobileNav} onOpenChange={setMobileNav}>
          <SheetTrigger asChild>
            <button
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="size-4.5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[270px] border-zinc-800 bg-sidebar p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <AppSidebar onNavigate={() => setMobileNav(false)} />
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <VeritasLogo className="size-4 shrink-0 lg:hidden" />
          <span className="truncate font-medium text-zinc-200">{title}</span>
        </div>
        {authenticated && (
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title="Search views and analyses (⌘K)"
            aria-label="Open command palette (Command K)"
            className="ml-1 hidden h-7 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 pl-2 pr-1 text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300 sm:flex"
          >
            <Search className="size-3.5" aria-hidden />
            <span className="text-xs">Search…</span>
            <kbd className="veritas-kbd">⌘K</kbd>
          </button>
        )}
      </div>

      {/* right: context selectors + profile */}
      <div className="flex shrink-0 items-center gap-2">
        {modelVersion ? (
          <span
            className="hidden items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-[11px] text-zinc-400 md:flex"
            title="Deterministic retrieval-augmented engine version"
          >
            <span className="size-1.5 rounded-full bg-emerald-400 veritas-pulse" aria-hidden />
            {modelVersion}
          </span>
        ) : (
          <span
            className="hidden items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 font-mono text-[11px] text-amber-300 md:flex"
            title="Engine unreachable — analyses degrade safely to Unverified and queue for human review"
          >
            <ShieldAlert className="size-3" aria-hidden />
            engine offline
          </span>
        )}
        <span
          className="hidden items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300 sm:flex"
          title="Phase 2 deployment: recommendations shown to reviewers only"
        >
          <Settings2 className="size-3" aria-hidden />
          Shadow mode
          <ChevronDown className="size-3 opacity-60" aria-hidden />
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-zinc-800/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50"
              aria-label="Account menu"
            >
              <Avatar className="size-7 border border-zinc-700">
                <AvatarFallback className="bg-zinc-800 text-[11px] font-semibold text-emerald-400">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-[13px] text-zinc-300 md:inline">{user?.name}</span>
              <ChevronDown className="size-3.5 text-zinc-500" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 border-zinc-800 bg-zinc-900">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm text-zinc-200">{user?.name}</p>
              <p className="text-xs text-zinc-500">{user?.email}</p>
              <p className="mt-1 inline-block rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                {ROLE_DISPLAY[user?.role ?? "viewer"] ?? user?.role}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-zinc-800" />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/" })}
              className="text-zinc-400 focus:text-zinc-100"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
