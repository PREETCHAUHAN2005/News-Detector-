import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

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
