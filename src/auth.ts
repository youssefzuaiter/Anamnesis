import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, hashPassword } from "@/lib/password";
import { config } from "@/lib/config";
import { checkSecondFactor } from "@/services/two-factor-service";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  // Authenticator or recovery code. Optional here, and required below only for an account that turned
  // two-factor on, so the form and every failure look the same for every account.
  code: z.string().max(100).optional(),
});

// Verifying against a throwaway hash keeps the "no such user" path as slow as the
// "wrong password" path, so response time cannot be used to enumerate accounts.
const DECOY_HASH_PROMISE = hashPassword(
  "decoy-password-that-is-never-a-real-credential",
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: config.NEXTAUTH_SECRET,
  // Derive the origin from the incoming request instead of a pinned
  // NEXTAUTH_URL. A stale value silently redirects sign-out to whatever app
  // owns that port, which is a real hazard when several dev servers are up.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password, code } = parsed.data;
        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
          select: { id: true, email: true, name: true, passwordHash: true, totpEnabledAt: true },
        });

        if (!user) {
          await verifyPassword(password, await DECOY_HASH_PROMISE);
          return null;
        }

        if (!(await verifyPassword(password, user.passwordHash))) return null;
        if (user.totpEnabledAt && !(await checkSecondFactor(user.id, code, Date.now()))) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
