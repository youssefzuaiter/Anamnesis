import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIcs } from "@/lib/ics";
import { buildIcs, escapeIcsText, foldIcsLine, type IcsItem } from "@/lib/ics-write";

const CRLF = "\r\n";
const octets = (text: string) => Buffer.byteLength(text, "utf8");
const stamp = new Date("2026-11-05T10:00:00Z");
// Built from code points so no invisible character sits in this source file.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const NEL = String.fromCharCode(0x85);
const LONE = String.fromCharCode(0xd800);

const timed = (over: Partial<IcsItem> = {}): IcsItem => ({
  uid: "event-1@anamnesis",
  summary: "Lecture",
  start: new Date("2026-11-10T09:00:00Z"),
  end: new Date("2026-11-10T10:00:00Z"),
  stamp,
  ...over,
});

/** The properties of a calendar with the folding undone, one string each. */
const unfolded = (ics: string) => ics.replace(/\r\n[ \t]/g, "").split(CRLF).filter((line) => line !== "");

// --- escaping -----------------------------------------------------------------------------------

test("the characters that mean something in a text value are escaped", () => {
  assert.equal(escapeIcsText("a;b,c\\d"), "a\\;b\\,c\\\\d");
  assert.equal(escapeIcsText("plain text 😀 ğ"), "plain text 😀 ğ");
});

test("every kind of line break becomes one escaped \\n, and a CR LF is one break, not two", () => {
  assert.equal(escapeIcsText("a\r\nb"), "a\\nb");
  assert.equal(escapeIcsText("a\rb"), "a\\nb");
  assert.equal(escapeIcsText("a\nb"), "a\\nb");
  for (const separator of [LS, PS, NEL]) assert.equal(escapeIcsText(`a${separator}b`), "a\\nb");
  for (const text of ["x\r\ny", "x\ry", "x\ny", `x${LS}y`, `x${PS}y`, `x${NEL}y`, "x\r\n\r\ny"]) {
    assert.ok(!/[\r\n\u2028\u2029\u0085]/.test(escapeIcsText(text)), JSON.stringify(text));
  }
});

test("other control characters are dropped (a tab is a space), and a lone surrogate is replaced", () => {
  assert.equal(escapeIcsText("a\u0000b\u0007c\u001bd\u007fe"), "abcde");
  assert.equal(escapeIcsText("a\tb"), "a b");
  assert.equal(escapeIcsText(`a${LONE}b`), "a�b");
  assert.equal(escapeIcsText("😀"), "😀", "a whole pair is kept");
});

// --- folding ------------------------------------------------------------------------------------

test("a line is folded at 75 octets and never inside a character", () => {
  assert.equal(foldIcsLine("short"), "short");
  const exact = "x".repeat(75);
  assert.equal(foldIcsLine(exact), exact);
  const long = "SUMMARY:" + "x".repeat(200);
  const folded = foldIcsLine(long);
  const pieces = folded.split(CRLF);
  assert.ok(pieces.length >= 3);
  for (const piece of pieces) assert.ok(octets(piece) <= 75, `${octets(piece)} octets`);
  for (const piece of pieces.slice(1)) assert.ok(piece.startsWith(" "), "a continuation begins with one space");
  assert.equal(folded.replace(/\r\n /g, ""), long, "unfolding gives the original");
});

test("a line of two-byte and four-byte characters is cut only between characters", () => {
  for (const unit of ["ğ", "😀", "日", "a😀"]) {
    const line = "SUMMARY:" + unit.repeat(120);
    const folded = foldIcsLine(line);
    for (const piece of folded.split(CRLF)) {
      assert.ok(octets(piece) <= 75, `${unit}: ${octets(piece)} octets`);
      assert.ok(!piece.includes("�"), "no character was split");
    }
    assert.equal(folded.replace(/\r\n /g, ""), line);
  }
});

// --- the calendar -------------------------------------------------------------------------------

test("a timed event and an all-day task are exactly this", () => {
  const ics = buildIcs(
    [
      timed({ location: "Hall C" }),
      {
        uid: "task-7@anamnesis",
        summary: "Due: Hand in report",
        start: new Date(2026, 10, 12), // 12 November, local midnight
        end: new Date(2026, 10, 13),
        allDay: true,
        stamp,
        transparent: true,
        category: "Task",
      },
    ],
    { name: "Anamnesis" },
  );
  assert.equal(
    ics,
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Anamnesis//Calendar feed//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Anamnesis",
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "X-PUBLISHED-TTL:PT1H",
      "BEGIN:VEVENT",
      "UID:event-1@anamnesis",
      "DTSTAMP:20261105T100000Z",
      "LAST-MODIFIED:20261105T100000Z",
      "DTSTART:20261110T090000Z",
      "DTEND:20261110T100000Z",
      "SUMMARY:Lecture",
      "LOCATION:Hall C",
      "TRANSP:OPAQUE",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:task-7@anamnesis",
      "DTSTAMP:20261105T100000Z",
      "LAST-MODIFIED:20261105T100000Z",
      "DTSTART;VALUE=DATE:20261112",
      "DTEND;VALUE=DATE:20261113",
      "SUMMARY:Due: Hand in report",
      "CATEGORIES:Task",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join(CRLF),
  );
});

test("every line ends in CR LF, none is over 75 octets, and no property holds a raw line break", () => {
  const ics = buildIcs([timed({ summary: "ğ".repeat(500), location: "😀".repeat(300) })], { name: "Anamnesis" });
  assert.ok(ics.endsWith(CRLF));
  assert.ok(!ics.replaceAll(CRLF, "").match(/[\r\n]/), "a bare CR or LF");
  for (const line of ics.split(CRLF)) assert.ok(octets(line) <= 75, `${octets(line)} octets`);
  for (const line of unfolded(ics)) assert.ok(!/[\r\n]/.test(line));
});

test("a title that tries to add calendar lines stays inside its own property", () => {
  const evil = "Evil\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:injected\r\nATTENDEE:mailto:x@example.com";
  const ics = buildIcs([timed({ summary: evil, location: "Room\r\nDESCRIPTION:injected" })], { name: "Anamnesis" });
  const lines = unfolded(ics);
  assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length, 1);
  assert.equal(lines.filter((l) => l === "END:VEVENT").length, 1);
  assert.ok(!lines.some((l) => l.startsWith("ATTENDEE") || l.startsWith("DESCRIPTION")));
  assert.equal(lines.filter((l) => l.startsWith("SUMMARY")).length, 1);
  assert.ok(lines.find((l) => l.startsWith("SUMMARY"))?.includes("Evil\\nEND:VEVENT"));
});

test("a title and a place are cut at 200 characters, without splitting a pair", () => {
  const ics = buildIcs([timed({ summary: "x".repeat(5000), location: "😀".repeat(500) })], { name: "Anamnesis" });
  const lines = unfolded(ics);
  assert.equal(lines.find((l) => l.startsWith("SUMMARY:"))?.slice("SUMMARY:".length).length, 200);
  const place = lines.find((l) => l.startsWith("LOCATION:"))?.slice("LOCATION:".length) ?? "";
  assert.equal(Array.from(place).length, 200);
  assert.ok(!place.includes("�"));
});

test("a calendar with nothing in it is still a calendar", () => {
  const ics = buildIcs([], { name: "Anamnesis" });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR" + CRLF) && ics.endsWith("END:VCALENDAR" + CRLF));
  assert.ok(!ics.includes("BEGIN:VEVENT"));
});

test("an item with an invalid date is left out, and an end that is not after its start is made sensible", () => {
  const ics = buildIcs(
    [
      timed({ uid: "bad@a", start: new Date(Number.NaN) }),
      timed({ uid: "bad2@a", end: new Date(Number.NaN) }),
      timed({ uid: "back@a", start: new Date("2026-11-10T10:00:00Z"), end: new Date("2026-11-10T09:00:00Z") }),
      { uid: "day@a", summary: "Day", start: new Date(2026, 10, 30), end: new Date(2026, 10, 29), allDay: true, stamp },
    ],
    { name: "Anamnesis" },
  );
  const lines = unfolded(ics);
  assert.ok(!lines.includes("UID:bad@a") && !lines.includes("UID:bad2@a"));
  const at = lines.indexOf("UID:back@a");
  assert.ok(lines[at + 3] === "DTSTART:20261110T100000Z" && lines[at + 4] === "DTEND:20261110T100000Z", "a timed end is never before its start");
  const day = lines.indexOf("UID:day@a");
  assert.equal(lines[day + 3], "DTSTART;VALUE=DATE:20261130");
  assert.equal(lines[day + 4], "DTEND;VALUE=DATE:20261201", "an all-day end is the next day, across the month end");
});

test("our own reader reads the calendar back: ids, titles, places and times", () => {
  const items = [
    timed({ uid: "event-a@anamnesis", summary: "Calculus, week 3; room B\\C", location: "Hall; C" }),
    timed({ uid: "event-b@anamnesis", summary: "Ders ğ ş ı İ 😀", start: new Date("2026-12-01T07:30:00Z"), end: new Date("2026-12-01T09:00:00Z") }),
  ];
  const back = parseIcs(buildIcs(items, { name: "Anamnesis" }));
  assert.equal(back.length, 2);
  assert.deepEqual(back.map((e) => e.uid), ["event-a@anamnesis", "event-b@anamnesis"]);
  assert.equal(back[0].title, "Calculus, week 3; room B\\C");
  assert.equal(back[0].location, "Hall; C");
  assert.equal(back[1].title, "Ders ğ ş ı İ 😀");
  assert.equal(back[1].start.toISOString(), "2026-12-01T07:30:00.000Z");
  assert.equal(back[1].end.toISOString(), "2026-12-01T09:00:00.000Z");
});

test("hostile 100,000-character values are built in milliseconds", () => {
  const big = "ğ\r\n;,\\😀".repeat(12_000);
  const start = performance.now();
  buildIcs([timed({ summary: big, location: big, uid: big })], { name: "Anamnesis" });
  escapeIcsText(big);
  foldIcsLine("X:" + big.replace(/[\r\n]/g, ""));
  assert.ok(performance.now() - start < 50, `took ${(performance.now() - start).toFixed(0)} ms`);
});
