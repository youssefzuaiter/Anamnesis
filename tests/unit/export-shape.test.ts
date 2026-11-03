import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPORTED_MODELS,
  EXPORT_FORMAT_VERSION,
  NOT_EXPORTED,
  NOT_INCLUDED,
  OMITTED_COLUMNS,
  afterCreated,
  afterRecorded,
  feedHost,
} from "@/lib/export-shape";

test("the format version is 2: the first export had none", () => {
  assert.equal(EXPORT_FORMAT_VERSION, 2);
});

test("feedHost keeps the host and nothing else of a feed address", () => {
  assert.equal(
    feedHost("webcal://user:pass@Cal.Example.com:8443/a/SECRETTOKEN/basic.ics?token=Q#frag"),
    "cal.example.com",
  );
  assert.equal(feedHost("https://calendar.google.com/calendar/ical/x/private-abc/basic.ics"), "calendar.google.com");
  assert.equal(feedHost("https://[::1]:3000/x"), "[::1]");
  assert.equal(feedHost("https://user:p@ss@host.example/feed"), "host.example");
});

test("a secret in any part of the address never reaches the output", () => {
  const secret = "S3CRET-t0ken";
  const addresses = [
    `https://example.com/${secret}/basic.ics`,
    `https://example.com/feed.ics?private=${secret}`,
    `https://user:${secret}@example.com/feed.ics`,
    `https://${secret}:x@example.com/feed.ics`,
    `https://example.com/feed.ics#${secret}`,
    `webcal://example.com:${8080}/${secret}`,
  ];
  for (const address of addresses) {
    const host = feedHost(address);
    assert.equal(host, "example.com", address);
    assert.ok(!String(host).includes(secret), address);
  }
});

test("an address with no readable host gives null, and nothing throws or hangs", () => {
  for (const address of ["", "not a url", "calendar.example.com", "javascript:alert(1)", "mailto:a@b.c", "file:///etc/passwd"]) {
    assert.equal(feedHost(address), null, JSON.stringify(address));
  }
  const start = performance.now();
  for (const hostile of ["a".repeat(100_000), `https://${"a".repeat(100_000)}`, `https://x/${"?".repeat(100_000)}`, "@".repeat(100_000)]) {
    feedHost(hostile);
  }
  assert.ok(performance.now() - start < 50, `took ${Math.round(performance.now() - start)} ms`);
});

test("the file says what it leaves out, with a reason for each", () => {
  assert.deepEqual(Object.keys(NOT_INCLUDED).sort(), [
    "attachmentFiles",
    "calendarFeedUrls",
    "deletedItems",
    "searchIndex",
    "signInPassword",
  ]);
  for (const [key, reason] of Object.entries(NOT_INCLUDED)) assert.ok(reason.trim().length > 20, key);
});

test("the table of exported models is one key each and never collides with a top-level key", () => {
  const keys = Object.values(EXPORTED_MODELS);
  assert.equal(new Set(keys).size, keys.length, "payload keys are unique");
  assert.equal(keys.length, 17);
  for (const reserved of ["user", "exportedAt", "formatVersion", "notIncluded"]) {
    assert.ok(!keys.includes(reserved), reserved);
  }
  assert.equal(EXPORTED_MODELS.Note, "notes");
  assert.equal(EXPORTED_MODELS.CalendarSubscription, "calendarSubscriptions");
  assert.ok(!("WorkspaceEmbedding" in EXPORTED_MODELS) && NOT_EXPORTED.WorkspaceEmbedding.trim().length > 20);
});

test("every deliberate omission of a column has a stated reason", () => {
  assert.deepEqual(Object.keys(OMITTED_COLUMNS).sort(), ["CalendarSubscription", "User"]);
  assert.ok(OMITTED_COLUMNS.User.passwordHash.trim().length > 20);
  assert.ok(OMITTED_COLUMNS.CalendarSubscription.url.trim().length > 20);
});

test("a page resumes after the last row's ordering value and id, never after a row that may be gone", () => {
  const at = new Date("2026-11-03T10:00:00.000Z");
  assert.deepEqual(afterCreated(null), {});
  assert.deepEqual(afterCreated({ at, id: "abc" }), { OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: "abc" } }] });
  assert.deepEqual(afterRecorded(null), {});
  assert.deepEqual(afterRecorded({ at, id: "abc" }), { OR: [{ recordedAt: { gt: at } }, { recordedAt: at, id: { gt: "abc" } }] });
});
