/**
 * /api/health is what a container healthcheck and the post-deploy smoke script
 * both rely on, so it is tested against a real database rather than assumed.
 *
 * DB-only and Ollama-free like the rest of this tier: whether Ollama answers
 * depends on the machine, so the deep check's Ollama field is only asserted to
 * be reported, never to be true.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/health/route";

after(async () => {
  await prisma.$disconnect();
});

type Health = {
  status: string;
  version: string;
  checks: Record<string, { ok: boolean; applied?: number; models?: boolean }>;
};

async function health(query = ""): Promise<{ response: Response; body: Health }> {
  const response = await GET(new Request(`http://localhost/api/health${query}`));
  return { response, body: (await response.json()) as Health };
}

function migrationFolders(): number {
  const root = path.join(process.cwd(), "prisma", "migrations");
  return readdirSync(root).filter((name) =>
    statSync(path.join(root, name)).isDirectory(),
  ).length;
}

test("health: a live database is reported healthy, and the answer is never cached", async () => {
  const { response, body } = await health();

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.checks.database.ok, true);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(typeof body.version, "string");
});

test("health: the shallow check does not run the deep ones", async () => {
  const { body } = await health();

  // A load balancer polling this every few seconds must not be calling Ollama.
  assert.equal("vector" in body.checks, false);
  assert.equal("migrations" in body.checks, false);
  assert.equal("ollama" in body.checks, false);
});

test("health: ?deep=1 confirms pgvector and that every migration in this release is applied", async () => {
  const { response, body } = await health("?deep=1");

  assert.equal(response.status, 200);
  assert.equal(body.checks.vector.ok, true);
  assert.equal(body.checks.migrations.ok, true);
  // The same comparison the smoke script makes after a deploy: an app that
  // started against a database nobody migrated must not look healthy.
  assert.equal(body.checks.migrations.applied, migrationFolders());
});

test("health: Ollama is reported but never decides whether the app is healthy", async () => {
  const { response, body } = await health("?deep=1");

  assert.equal(typeof body.checks.ollama.ok, "boolean");
  assert.equal(typeof body.checks.ollama.models, "boolean");
  // Whatever Ollama said, a healthy database and schema still means HTTP 200 —
  // the app falls back to keyword search rather than failing without it.
  assert.equal(response.status, 200);
});

test("health: the answer never contains a connection string or a secret", async () => {
  const { body } = await health("?deep=1");
  const text = JSON.stringify(body);

  for (const secret of [
    process.env.DATABASE_URL,
    process.env.NEXTAUTH_SECRET,
  ]) {
    assert.ok(secret, "the test environment must define this variable");
    assert.equal(text.includes(secret), false);
  }
});
