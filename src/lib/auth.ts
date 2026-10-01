import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { AUTH_LOGIN_ENABLED, DEMO_AUTO_ACCOUNT } from "@/lib/auth-mode";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  secret: process.env.NEXTAUTH_SECRET ?? "veritas-dev-secret-change-in-production",
  providers: [
    CredentialsProvider({
      name: "Veritas credentials",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "you@veritas.io" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await db.user.findUnique({ where: { email: credentials.email.toLowerCase() } });
        if (!user) return null;
        if (!verifyPassword(credentials.password, user.passwordHash)) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role ?? "viewer";
        token.uid = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; role?: string }).id = token.uid as string;
        (session.user as { id?: string; role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  pages: { signIn: "/" },
};

export type SessionUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  role?: string;
};

/**
 * Unified identity resolver for API routes.
 *
 * - AUTH_LOGIN_ENABLED = true  → behaves exactly like getServerSession():
 *   returns the signed-in user or null (routes answer 401).
 * - AUTH_LOGIN_ENABLED = false → a real session still wins (the client
 *   auto-signs-in the demo reviewer), but when no session cookie is present
 *   the call falls back to the seeded demo reviewer instead of null, so the
 *   API works without any login screen while keeping the BRD role gates
 *   (reviewer / senior / admin) intact.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user as SessionUser | undefined;
  if (user?.id) return user;
  if (AUTH_LOGIN_ENABLED) return null;
  return getDemoFallbackUser();
}

/** Demo-reviewer fallback (60s in-process cache; never throws). */
async function getDemoFallbackUser(): Promise<SessionUser> {
  if (fallbackCache && Date.now() - fallbackCacheAt < 60_000) return fallbackCache;
  try {
    const user = await db.user.findUnique({ where: { email: DEMO_AUTO_ACCOUNT.email } });
    if (user) {
      fallbackCache = { id: user.id, name: user.name, email: user.email, role: user.role };
      fallbackCacheAt = Date.now();
      return fallbackCache;
    }
  } catch {
    // DB unavailable — a synthetic identity keeps audit attribution honest
  }
  return { id: "demo-fallback", name: "Demo reviewer", email: DEMO_AUTO_ACCOUNT.email, role: "reviewer" };
}

let fallbackCache: SessionUser | null = null;
let fallbackCacheAt = 0;
