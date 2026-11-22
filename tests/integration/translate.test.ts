/**
 * Translate a note (ROADMAP item 57) against a real Postgres. The engine is a scripted fake (and, for the service client, a local HTTP server), so no
 * test reaches Ollama. Checked: the original is never touched, only the caller's own note is read, what code protects comes back exactly, a line the
 * engine breaks is kept as written, and the engines fall back as written.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { MAX_TRANSLATE_CHARS } from "@/lib/translate";
import { chain, libreEngine, translateNote, type Engine } from "@/services/translate-service";

const made: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `tr-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const CONTENT = ["# Loss", "", "The loss $L(x)$ falls, see [[Backprop]] and `fit()`.", "", "```py", "x = 1", "```", "", "Last line here."].join("\n");
const note = (userId: string, content = CONTENT, title = "Loss notes") => prisma.note.create({ data: { userId, title, content } });
/** Pretends to translate: upper-cases the words and leaves the markers alone. */
const shout: Engine = async (lines) => lines.map((l) => l.replace(/[^⟦⟧\d\s]+/gu, (w) => w.toUpperCase()));
const NOW = new Date(2026, 10, 23);
const code = (e: unknown) => (e instanceof AppError ? e.code : "other");

test("the translation is a note proposal that links back, keeps protected parts and code exactly, and writes nothing", async () => {
  const me = await newUser();
  const n = await note(me);
  const r = await translateNote(me, n.id, "tr", { engine: shout, now: NOW });
  assert.equal(r.proposal.kind, "note");
  if (r.proposal.kind !== "note") return;
  assert.equal(r.proposal.title, "Loss notes (Turkish)");
  assert.match(r.proposal.content, /^> Machine translation of \[\[Loss notes\]\] into Turkish, made on 2026-11-23\./);
  assert.ok(r.proposal.content.includes("THE LOSS $L(x)$ FALLS"), "the formula went back exactly where it was");
  for (const kept of ["[[Backprop]]", "`fit()`", "```py\nx = 1\n```", "# LOSS"]) assert.ok(r.proposal.content.includes(kept), kept);
  assert.deepEqual([r.translated, r.kept], [3, 0]);
  assert.equal(await prisma.note.count({ where: { userId: me } }), 1, "nothing was saved");
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: n.id } })).content, CONTENT, "the original is untouched");
});

test("only the caller's own note, and only a listed language", async () => {
  const me = await newUser();
  const other = await newUser();
  const theirs = await note(other);
  await assert.rejects(translateNote(me, theirs.id, "tr", { engine: shout }), (e) => code(e) === "RESOURCE_NOT_FOUND");
  await assert.rejects(translateNote(me, randomUUID(), "tr", { engine: shout }), (e) => code(e) === "RESOURCE_NOT_FOUND");
  const mine = await note(me);
  for (const bad of ["xx", "TR", "", "tr ", "Turkish"]) await assert.rejects(translateNote(me, mine.id, bad, { engine: shout }), (e) => code(e) === "VALIDATION_ERROR", bad);
  await prisma.note.update({ where: { id: mine.id }, data: { deletedAt: new Date() } });
  await assert.rejects(translateNote(me, mine.id, "tr", { engine: shout }), (e) => code(e) === "RESOURCE_NOT_FOUND", "a trashed note");
});

test("a note too long, or with no text in it, is refused before any engine runs", async () => {
  const me = await newUser();
  let calls = 0;
  const counting: Engine = async (l, t) => { calls += 1; return shout(l, t); };
  const long = await note(me, Array.from({ length: MAX_TRANSLATE_CHARS / 10 + 1 }, () => "word word").join("\n"));
  assert.ok(long.content.length > MAX_TRANSLATE_CHARS);
  await assert.rejects(translateNote(me, long.id, "de", { engine: counting }), (e) => code(e) === "VALIDATION_ERROR");
  const onlyCode = await note(me, "```py\nprint(1)\n```\n\n`x` $y$");
  await assert.rejects(translateNote(me, onlyCode.id, "de", { engine: counting }), (e) => code(e) === "VALIDATION_ERROR");
  assert.equal(calls, 0);
});

test("an engine that drops a marker or merges lines costs only those lines, which stay as written", async () => {
  const me = await newUser();
  const n = await note(me, "Alpha line\nThe loss $a$ here\nGamma line");
  const sloppy: Engine = async (lines) => lines.map((l) => (l.includes("⟦") ? "no marker kept" : l.toUpperCase()));
  const r = await translateNote(me, n.id, "tr", { engine: sloppy, now: NOW });
  if (r.proposal.kind !== "note") throw new Error("kind");
  assert.ok(r.proposal.content.endsWith("ALPHA LINE\nThe loss $a$ here\nGAMMA LINE"));
  assert.deepEqual([r.translated, r.kept], [2, 1]);
  assert.match(r.proposal.content, /1 line could not be translated safely and is kept as written\./);

  // A batch answered with the wrong number of strings is asked again one line at a time.
  const asked: number[] = [];
  const merging: Engine = async (lines) => { asked.push(lines.length); return lines.length > 1 ? [lines.join(" ")] : lines.map((l) => l.toUpperCase()); };
  const again = await translateNote(me, n.id, "tr", { engine: merging, now: NOW });
  assert.deepEqual(asked, [3, 1, 1, 1]);
  assert.equal(again.translated + again.kept, 3);
});

test("when nothing could be translated safely, nothing is proposed", async () => {
  const me = await newUser();
  const n = await note(me, "Alpha line\nBeta line");
  await assert.rejects(translateNote(me, n.id, "tr", { engine: async () => ["", ""] }), (e) => code(e) === "AI_OUTPUT_INVALID");
});

test("progress is reported per batch and a stopped request stops calling the engine", async () => {
  const me = await newUser();
  const n = await note(me, Array.from({ length: 45 }, (_, i) => `Line number ${i} of the note`).join("\n"));
  const seen: [number, number][] = [];
  await translateNote(me, n.id, "de", { engine: shout, onProgress: (d, t) => seen.push([d, t]) });
  assert.deepEqual(seen, [[1, 3], [2, 3], [3, 3]]);
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(translateNote(me, n.id, "de", { engine: async (l, t) => { calls += 1; return shout(l, t); }, signal: controller.signal }), (e) => code(e) === "VALIDATION_ERROR");
  assert.equal(calls, 0);
});

test("engines fall back only when one is unreachable", async () => {
  const down: Engine = async () => { throw new AppError("INTEGRATION_ERROR", "down"); };
  const bad: Engine = async () => { throw new AppError("AI_OUTPUT_INVALID", "bad"); };
  assert.deepEqual(await chain([down, shout])(["abc"], "tr"), ["ABC"]);
  await assert.rejects(chain([bad, shout])(["abc"], "tr"), (e) => code(e) === "AI_OUTPUT_INVALID");
  await assert.rejects(chain([down, down])(["abc"], "tr"), (e) => code(e) === "INTEGRATION_ERROR");
});

test("the LibreTranslate client sends the lines in one request and reads the answer, and refuses what it cannot read", async () => {
  const requests: unknown[] = [];
  let mode: "ok" | "500" | "junk" | "redirect" = "ok";
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/followed") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ translatedText: ["followed"] })); return; }
      requests.push({ url: req.url, body: JSON.parse(body || "null") });
      if (mode === "500") { res.statusCode = 500; res.end("no"); return; }
      if (mode === "redirect") { res.statusCode = 302; res.setHeader("Location", "/followed"); res.end(); return; }
      res.setHeader("Content-Type", "application/json");
      res.end(mode === "junk" ? JSON.stringify({ translatedText: "not an array" }) : JSON.stringify({ translatedText: (JSON.parse(body).q as string[]).map((s) => `${s}!`) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const engine = libreEngine(base);
    assert.deepEqual(await engine(["a ⟦0⟧", "b"], "tr"), ["a ⟦0⟧!", "b!"]);
    assert.deepEqual(requests[0], { url: "/translate", body: { q: ["a ⟦0⟧", "b"], source: "auto", target: "tr", format: "text" } });
    for (const m of ["500", "junk", "redirect"] as const) {
      mode = m;
      await assert.rejects(engine(["a"], "tr"), (e) => code(e) === "INTEGRATION_ERROR", m);
    }
  } finally {
    server.close();
  }
  await assert.rejects(libreEngine("http://127.0.0.1:1")(["a"], "tr"), (e) => code(e) === "INTEGRATION_ERROR", "unreachable");
});
