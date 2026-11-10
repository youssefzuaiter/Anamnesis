/**
 * The ntfy publisher against a real HTTP server on the loopback interface: what goes over the wire, and
 * what a failure says (never the token). No ntfy needed; ops/rehearse and the deploy smoke check talk to
 * the real one.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ntfyPublisher } from "@/lib/ntfy";

const TOKEN = "tk_abcdefghijklmnopqrstuvwxyz123";
const servers: Server[] = [];
after(() => {
  for (const server of servers) server.close();
});

type Seen = { method: string; url: string; auth: string | undefined; type: string | undefined; body: unknown };

async function serve(handler: (req: IncomingMessage, res: import("node:http").ServerResponse, seen: Seen[]) => void) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        auth: req.headers.authorization,
        type: req.headers["content-type"],
        body: raw ? JSON.parse(raw) : null,
      });
      handler(req, res, seen);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, seen };
}

const ok = (_req: IncomingMessage, res: import("node:http").ServerResponse) => {
  res.writeHead(200, { "content-type": "application/json" }).end('{"id":"x"}');
};

test("a message is one JSON POST to the server root, with the token and nothing else secret", async () => {
  const { base, seen } = await serve(ok);
  await ntfyPublisher(`${base}/`, TOKEN)({ topic: "anamnesis-abc", title: "Due today", body: "A, B", tags: ["calendar"] });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], {
    method: "POST",
    url: "/",
    auth: `Bearer ${TOKEN}`,
    type: "application/json",
    body: { topic: "anamnesis-abc", title: "Due today", message: "A, B", tags: ["calendar"], priority: 3 },
  });
});

test("a server under a path prefix is posted to under that prefix", async () => {
  const { base, seen } = await serve(ok);
  await ntfyPublisher(`${base}/ntfy`, TOKEN)({ topic: "t", title: "x", body: "y" });
  assert.equal(seen[0].url, "/ntfy/");
  assert.deepEqual((seen[0].body as { tags: string[] }).tags, []);
});

test("Turkish and other non-ASCII titles arrive exactly as written", async () => {
  const { base, seen } = await serve(ok);
  const title = "Ödev 3 — ğüşıçö İ";
  await ntfyPublisher(base, TOKEN)({ topic: "t", title, body: "Çalış\nyarın" });
  assert.deepEqual([(seen[0].body as { title: string }).title, (seen[0].body as { message: string }).message], [title, "Çalış\nyarın"]);
});

test("a refusal says the status and never the token", async () => {
  const { base } = await serve((_req, res) => res.writeHead(401).end(`{"error":"unauthorized ${TOKEN}"}`));
  await assert.rejects(
    () => ntfyPublisher(base, TOKEN)({ topic: "t", title: "x", body: "y" }),
    (error: unknown) => error instanceof Error && error.message === "ntfy answered 401" && !error.message.includes(TOKEN),
  );
});

test("a redirect is not followed, so the token never goes to another address", async () => {
  const target = await serve(ok);
  const { base } = await serve((_req, res) => res.writeHead(307, { location: `${target.base}/stolen` }).end());
  await assert.rejects(() => ntfyPublisher(base, TOKEN)({ topic: "t", title: "x", body: "y" }), /^Error: ntfy did not answer \(network error\)$/);
  assert.equal(target.seen.length, 0);
});

// The test's own limit: a publisher without a timeout would otherwise hang the whole run.
test("a server that never answers, or is not there, fails within the time allowed", { timeout: 10_000 }, async () => {
  const { base } = await serve(() => {
    /* never answers */
  });
  const started = Date.now();
  await assert.rejects(() => ntfyPublisher(base, TOKEN, 300)({ topic: "t", title: "x", body: "y" }), /^Error: ntfy did not answer \(timed out\)$/);
  assert.ok(Date.now() - started < 2_000, `took ${Date.now() - started} ms`);

  const closed = await serve(ok);
  servers.pop()?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await assert.rejects(() => ntfyPublisher(closed.base, TOKEN, 1_000)({ topic: "t", title: "x", body: "y" }), /^Error: ntfy did not answer \(ECONNREFUSED\)$/);
});
