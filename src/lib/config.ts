import "server-only";
import { z } from "zod";
import { registrationCode } from "@/lib/registration";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: z.string().url().optional(),
  OLLAMA_BASE_URL: z.string().url(),
  OLLAMA_CHAT_MODEL: z.string().min(1),
  OLLAMA_EMBEDDING_MODEL: z.string().min(1),
  /** Optional invite code for accounts after the first; see "Registration" in CLAUDE.md. */
  REGISTRATION_CODE: registrationCode,
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error(
    "[ERROR] Invalid environment variables:",
    JSON.stringify(z.treeifyError(parsedEnv.error), null, 2),
  );
  throw new Error(
    "Server failed to start due to missing or invalid environment configuration.",
  );
}

export const config = parsedEnv.data;

// Pinned to the vector(768) column in prisma/schema.prisma. Changing the
// embedding model to one with different output dimensions requires a migration,
// so this is a code constant rather than an env var.
export const EMBEDDING_DIMENSIONS = 768;
