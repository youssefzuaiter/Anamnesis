/**
 * The guarded fetcher against real HTTP servers on the loopback interface. Loopback is blocked by design,
 * so the tests that need to reach these servers pass an explicit `allowAddress` for 127.0.0.1 only; the
 * app never passes one. The ones that prove blocking pass nothing, or a resolver that lies.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { safeFetchText, SafeFetchError } from "@/lib/safe-fetch";

const servers: Server[] = [];
after(() => {
  for (const server of servers) {
    server.closeAllConnections?.();
    server.close();
  }
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const html = (res: ServerResponse, body: string, type = "text/html; charset=utf-8") => res.writeHead(200, { "content-type": type }).end(body);
const loopbackOnly = (ip: string) => ip === "127.0.0.1";
const base = { maxBytes: 1_000_000, timeoutMs: 3_000, accept: "text/html", allow: (type: string) => type.startsWith("text/html") };
const failsWith = (kind: SafeFetchError["kind"]) => (error: unknown) => error instanceof SafeFetchError && error.kind === kind;

test("a loopback server is refused unless the caller explicitly allows that one address", async () => {
  const url = await serve((_req, res) => html(res, "<p>hi</p>"));
  await assert.rejects(() => safeFetchText(new URL(url), base), failsWith("blocked"));
  const page = await safeFetchText(new URL(url), { ...base, allowAddress: loopbackOnly });
  assert.equal(page.text, "<p>hi</p>");
  assert.equal(page.contentType, "text/html; charset=utf-8");
});

test("a public-looking name that resolves to a private address is refused when connecting", async () => {
  const url = await serve((_req, res) => html(res, "secret"));
  const port = new URL(url).port;
  let resolved = 0;
  const lying = async (host: string) => {
    resolved++;
    assert.equal(host, "public.example.com");
    return [{ address: "127.0.0.1", family: 4 }];
  };
  await assert.rejects(() => safeFetchText(new URL(`http://public.example.com:${port}/`), { ...base, resolve: lying }), failsWith("blocked"));
  assert.equal(resolved, 1);
  const mixed = async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }];
  await assert.rejects(() => safeFetchText(new URL(`http://public.example.com:${port}/`), { ...base, resolve: mixed }), failsWith("blocked"), "one private answer is enough to refuse");
});

test("redirects are followed by hand, at most three, and every hop is checked", async () => {
  let hits = 0;
  const final = await serve((_req, res) => html(res, "<p>landed</p>"));
  const chain = await serve((req, res) => {
    hits++;
    const n = Number(req.url?.slice(1) || "0");
    if (n < 2) res.writeHead(302, { location: `/${n + 1}` }).end();
    else res.writeHead(301, { location: final }).end();
  });
  const page = await safeFetchText(new URL(`${chain}/0`), { ...base, allowAddress: loopbackOnly });
  assert.equal(page.text, "<p>landed</p>");
  assert.equal(page.finalUrl.href, `${final}/`);

  const loop = await serve((req, res) => res.writeHead(302, { location: `/x${req.url}` }).end());
  await assert.rejects(() => safeFetchText(new URL(loop), { ...base, allowAddress: loopbackOnly }), failsWith("redirects"));

  const inward = await serve((_req, res) => res.writeHead(302, { location: "http://10.0.0.1/admin" }).end());
  await assert.rejects(() => safeFetchText(new URL(inward), { ...base, allowAddress: loopbackOnly }), failsWith("blocked"));
  const toFile = await serve((_req, res) => res.writeHead(302, { location: "file:///etc/passwd" }).end());
  await assert.rejects(() => safeFetchText(new URL(toFile), { ...base, allowAddress: loopbackOnly }), failsWith("blocked"));
  assert.ok(hits >= 3);
});

test("a body over the cap is cut off, also when it is compressed", async () => {
  const big = await serve((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    const chunk = "x".repeat(64 * 1024);
    let sent = 0;
    const pump = () => {
      while (sent < 40) {
        sent++;
        if (!res.write(chunk)) return void res.once("drain", pump);
      }
      res.end();
    };
    pump();
  });
  await assert.rejects(() => safeFetchText(new URL(big), { ...base, maxBytes: 1_000_000, allowAddress: loopbackOnly }), failsWith("too-large"));

  const bomb = gzipSync(Buffer.alloc(20_000_000, 0x61));
  const zipped = await serve((_req, res) => res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(bomb));
  await assert.rejects(() => safeFetchText(new URL(zipped), { ...base, maxBytes: 1_000_000, allowAddress: loopbackOnly }), failsWith("too-large"));

  const small = await serve((_req, res) => res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(gzipSync("<p>çok güzel</p>")));
  assert.equal((await safeFetchText(new URL(small), { ...base, allowAddress: loopbackOnly })).text, "<p>çok güzel</p>");
});

test("a server that drips, or never answers, is stopped at the deadline", async () => {
  const drip = await serve((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    const timer = setInterval(() => res.write("."), 100);
    res.on("close", () => clearInterval(timer));
  });
  const started = Date.now();
  await assert.rejects(() => safeFetchText(new URL(drip), { ...base, timeoutMs: 500, allowAddress: loopbackOnly }), failsWith("timeout"));
  assert.ok(Date.now() - started < 2_000);
  const silent = await serve(() => {});
  await assert.rejects(() => safeFetchText(new URL(silent), { ...base, timeoutMs: 400, allowAddress: loopbackOnly }), failsWith("timeout"));
});

test("a page of the wrong type, or an error status, is refused with what happened", async () => {
  const pdf = await serve((_req, res) => html(res, "%PDF-1.7", "application/pdf"));
  await assert.rejects(() => safeFetchText(new URL(pdf), { ...base, allowAddress: loopbackOnly }), failsWith("type"));
  const missing = await serve((_req, res) => res.writeHead(404, { "content-type": "text/html" }).end("nope"));
  await assert.rejects(
    () => safeFetchText(new URL(missing), { ...base, allowAddress: loopbackOnly }),
    (error: unknown) => error instanceof SafeFetchError && error.kind === "status" && error.status === 404,
  );
});

test("the declared charset is honoured", async () => {
  const latin = await serve((_req, res) => res.writeHead(200, { "content-type": "text/html; charset=iso-8859-9" }).end(Buffer.from([0x3c, 0x70, 0x3e, 0xfd, 0xf0, 0x3c, 0x2f, 0x70, 0x3e])));
  assert.equal((await safeFetchText(new URL(latin), { ...base, allowAddress: loopbackOnly })).text, "<p>ığ</p>");
});
