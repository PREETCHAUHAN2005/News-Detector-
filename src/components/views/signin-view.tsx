"use client";
/**
 * SignInView — the only screen rendered while unauthenticated.
 * Centered dark card on zinc-950 with the Veritas grid texture, credential
 * form + one-click demo accounts (seeded users, password "veritas123").
 */
import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { motion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { VeritasLogo } from "@/components/veritas-logo";
import { cn } from "@/lib/utils";

interface DemoAccount {
  name: string;
  role: string;
  email: string;
  description: string;
  badgeClass: string;
}

const DEMO_PASSWORD = "veritas123";

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    name: "Priya Sharma",
    role: "Reviewer",
    email: "reviewer@veritas.io",
    description: "Accepts, edits or rejects model verdicts from the review queue.",
    badgeClass: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  },
  {
    name: "Marcus Chen",
    role: "Senior reviewer",
    email: "senior@veritas.io",
    description: "Also resolves appeals and signs off second reviews on contested claims.",
    badgeClass: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  },
  {
    name: "Avery Wallace",
    role: "Admin",
    email: "admin@veritas.io",
    description: "Full access — manages the trusted-source registry and the audit log.",
    badgeClass: "text-rose-400 border-rose-500/40 bg-rose-500/10",
  },
  {
    name: "Sam Rivera",
    role: "Viewer",
    email: "viewer@veritas.io",
    description: "Read-only observation — follows the queue, verdicts and analytics.",
    badgeClass: "text-teal-400 border-teal-500/40 bg-teal-500/10",
  },
];

export function SignInView() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doSignIn(nextEmail: string, nextPassword: string): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const result = await signIn("credentials", {
        email: nextEmail,
        password: nextPassword,
        redirect: false,
      });
      if (result?.error) {
        setError("Invalid credentials");
        setSubmitting(false);
        return;
      }
      // Success — SessionProvider flips `status` to "authenticated" and the
      // shell (page.tsx) re-renders into the workbench automatically, so we
      // deliberately keep the button in its loading state to avoid a flash.
    } catch {
      setError("Sign-in service unavailable — please try again.");
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitting) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password to continue.");
      return;
    }
    void doSignIn(email.trim(), password);
  }

  function handleDemoAccount(account: DemoAccount): void {
    if (submitting) return;
    setEmail(account.email);
    setPassword(DEMO_PASSWORD);
    void doSignIn(account.email, DEMO_PASSWORD);
  }

  return (
    <div className="relative flex min-h-full flex-col items-center bg-zinc-950 px-4 py-10">
      {/* Subtle grid texture (fades out radially, decorative only) */}
      <div aria-hidden="true" className="veritas-grid-bg pointer-events-none absolute inset-0" />

      <div className="relative z-10 flex w-full flex-1 flex-col items-center justify-center gap-8">
        {/* Wordmark */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="flex flex-col items-center gap-3 text-center"
        >
          <div className="flex items-center gap-3">
            <VeritasLogo className="size-11" />
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">Veritas</h1>
          </div>
          <p className="text-sm text-zinc-500">Evidence-first fact-checking workbench</p>
        </motion.header>

        {/* Sign-in card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          <Card className="rounded-xl border-zinc-800 bg-zinc-900/60 shadow-xl shadow-black/30">
            <CardContent className="p-6 sm:p-8">
              <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="signin-email" className="text-[13px] text-zinc-400">
                    Email
                  </Label>
                  <Input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    spellCheck={false}
                    placeholder="you@veritas.io"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    required
                    className="h-10 rounded-lg border-zinc-800 bg-zinc-950/60 text-zinc-100 placeholder:text-zinc-600"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="signin-password" className="text-[13px] text-zinc-400">
                    Password
                  </Label>
                  <Input
                    id="signin-password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    required
                    className="h-10 rounded-lg border-zinc-800 bg-zinc-950/60 text-zinc-100 placeholder:text-zinc-600"
                  />
                </div>

                {error ? (
                  <p
                    role="alert"
                    aria-live="polite"
                    className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300"
                  >
                    {error}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  disabled={submitting}
                  className="h-10 w-full rounded-lg text-[13px] font-medium"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Signing in…
                    </>
                  ) : (
                    "Sign in"
                  )}
                </Button>
              </form>

              {/* Demo accounts — one click fills & submits seeded credentials */}
              <div className="mt-6">
                <Separator className="bg-zinc-800" />
                <div className="mt-5 flex flex-col gap-1">
                  <h2 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    Demo accounts
                  </h2>
                  <p className="text-xs text-zinc-600">
                    One click signs you in with a seeded reviewer account.
                  </p>
                </div>

                <div className="mt-3 flex flex-col gap-2">
                  {DEMO_ACCOUNTS.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      onClick={() => handleDemoAccount(account)}
                      disabled={submitting}
                      className="group flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:pointer-events-none disabled:opacity-50"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-zinc-200 group-hover:text-zinc-100">
                            {account.name}
                          </span>
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                              account.badgeClass
                            )}
                          >
                            {account.role}
                          </span>
                        </span>
                        <span className="text-xs leading-relaxed text-zinc-500">
                          {account.description}
                        </span>
                        <span className="truncate font-mono text-[11px] text-zinc-600">
                          {account.email}
                        </span>
                      </span>
                      <ArrowRight
                        className="size-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-400"
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Footer strip */}
      <footer className="relative z-10 flex flex-col items-center gap-1.5 pt-8 text-center">
        <p className="text-xs text-zinc-500">
          Assisted by automation, confirmed by humans · Veritas v1.0
        </p>
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          Phase 2 shadow deployment
        </p>
      </footer>
    </div>
  );
}
