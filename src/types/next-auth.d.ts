import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
    /** The id of this browser's AuthSession row (services/session-service.ts). */
    sessionId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** Names the AuthSession row that keeps this token valid. */
    sid?: string;
  }
}
