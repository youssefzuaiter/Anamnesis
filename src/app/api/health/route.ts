import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";

// Read at request time. A health endpoint that Next prerendered at build would
// report the build machine's database, which is the one thing it must not do.
export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 3_000;

type Check = { ok: boolean };
type Migrations = Check & { applied: number };

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), CHECK_TIMEOUT_MS),
    ),
  ]);
}

async function checkDatabase(): Promise<Check> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1 AS ok`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// Semantic search and the assistant are meaningless without the vector type, and
// a database restored from a dump without its extensions is exactly the kind of
// "up but wrong" state a health check exists to catch.
async function checkVector(): Promise<Check> {
  try {
    const rows = await withTimeout(
      prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM pg_extension WHERE extname = 'vector'`,
    );
    return { ok: (rows[0]?.n ?? 0) > 0 };
  } catch {
    return { ok: false };
  }
}

// Only the count is reported, never names. The smoke script compares it with the
// number of migration folders in the release it just deployed, which catches an
// app that started against a database nobody migrated.
async function checkMigrations(): Promise<Migrations> {
  try {
    const rows = await withTimeout(
      prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    const applied = rows[0]?.n ?? 0;
    return { ok: applied > 0, applied };
  } catch {
    return { ok: false, applied: 0 };
  }
}

// Reported but never fatal: the app degrades without Ollama (notes search falls
// back to keywords) rather than failing, so a container orchestrator restarting
// it over a stopped model server would only make things worse.
async function checkOllama(): Promise<Check & { models: boolean }> {
  try {
    const response = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, models: false };

    const body = (await response.json()) as { models?: { name: string }[] };
    const installed = (body.models ?? []).map((model) => model.name);
    const has = (wanted: string) =>
      installed.some((name) => name === wanted || name.startsWith(`${wanted}:`));

    return {
      ok: true,
      models: has(config.OLLAMA_CHAT_MODEL) && has(config.OLLAMA_EMBEDDING_MODEL),
    };
  } catch {
    return { ok: false, models: false };
  }
}

/**
 * GET /api/health — is the app able to serve? Checks the database.
 * GET /api/health?deep=1 — also pgvector, applied migrations and Ollama.
 *
 * Unauthenticated on purpose (a load balancer or a deploy script has no
 * session), so it answers with booleans and counts only: no hostnames, no
 * versions of anything but this app's own release, no error text.
 */
export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get("deep") === "1";

  const database = await checkDatabase();
  const checks: Record<string, unknown> = { database };
  let healthy = database.ok;

  if (deep) {
    const [vector, migrations, ollama] = await Promise.all([
      database.ok ? checkVector() : Promise.resolve<Check>({ ok: false }),
      database.ok
        ? checkMigrations()
        : Promise.resolve<Migrations>({ ok: false, applied: 0 }),
      checkOllama(),
    ]);
    checks.vector = vector;
    checks.migrations = migrations;
    checks.ollama = ollama;
    healthy = healthy && vector.ok && migrations.ok;
  }

  return NextResponse.json(
    {
      status: healthy ? "ok" : "unhealthy",
      // Set at image build time from the commit, so a deploy can confirm that the
      // release it asked for is the one actually answering.
      version: process.env.APP_VERSION ?? "dev",
      checks,
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
