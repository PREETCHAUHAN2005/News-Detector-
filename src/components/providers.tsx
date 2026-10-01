"use client";
import { SessionProvider, signIn, useSession } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AUTH_LOGIN_ENABLED, DEMO_AUTO_ACCOUNT } from "@/lib/auth-mode";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );
  return (
    <SessionProvider refetchOnWindowFocus={false}>
      <QueryClientProvider client={queryClient}>
        {/* Login feature disabled (see src/lib/auth-mode.ts): silently establish
            the demo reviewer session so the workbench opens with NO login screen
            while every role-gated feature keeps working. */}
        {!AUTH_LOGIN_ENABLED ? <AutoSession /> : null}
        {children}
      </QueryClientProvider>
    </SessionProvider>
  );
}

/** Establishes the automatic demo session whenever none is present. */
function AutoSession() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "unauthenticated") return;
    let cancelled = false;
    void signIn("credentials", {
      email: DEMO_AUTO_ACCOUNT.email,
      password: DEMO_AUTO_ACCOUNT.password,
      redirect: false,
    }).catch(() => {
      // ignored — the workbench still renders (server-side identity fallback)
      if (!cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  return null;
}
