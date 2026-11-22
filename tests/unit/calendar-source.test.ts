import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "@/lib/api-response";
import { PROVIDER_STEPS, SYNC_INTERVAL_MS, hostOf, isDue, maskedAddress, providerOf, safeSyncError } from "@/lib/calendar-source";

test("the provider is named from the host of the link, whatever the scheme", () => {
  assert.equal(providerOf("https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc123/basic.ics").id, "google");
  assert.equal(providerOf("webcal://calendar.google.com/calendar/ical/x/basic.ics").id, "google");
  for (const host of ["outlook.office365.com", "outlook.live.com", "outlook.office.com"]) assert.equal(providerOf(`https://${host}/owa/calendar/abc/reachcalendar.ics`).id, "outlook", host);
  assert.equal(providerOf("webcal://p01-caldav.icloud.com/published/2/abc").id, "apple");
  assert.equal(providerOf("https://timetable.university.edu.tr/feed.ics").id, "other");
  assert.equal(providerOf("not a link").id, "other");
  assert.equal(providerOf("").id, "other");
});

test("a look-alike host is not a provider", () => {
  for (const url of ["https://calendar.google.com.evil.example/x.ics", "https://evilcalendar.google.com.example/x.ics", "https://notoutlook.office365.com.example/x.ics", "https://example.com/calendar.google.com/x.ics", "https://example.com/?u=outlook.live.com"]) {
    assert.equal(providerOf(url).id, "other", url);
  }
});

test("only the host of a link is ever shown, never its path or query, which carry the secret", () => {
  assert.equal(hostOf("https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc123/basic.ics"), "calendar.google.com");
  assert.equal(hostOf("webcal://Outlook.Office365.com/owa/calendar/x@y.com/secrettoken/reachcalendar.ics?x=1"), "outlook.office365.com");
  assert.equal(hostOf("nonsense"), null);
  const masked = maskedAddress("https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc123/basic.ics");
  assert.equal(masked, "calendar.google.com/…");
  assert.ok(!masked.includes("abc123") && !masked.includes("gmail"));
  assert.equal(maskedAddress("nonsense"), "a calendar link");
});

test("a sync is due once an interval has passed since the last try, and never tried is due", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  assert.equal(isDue(null, now), true);
  assert.equal(isDue(new Date(now.getTime() - SYNC_INTERVAL_MS), now), true);
  assert.equal(isDue(new Date(now.getTime() - SYNC_INTERVAL_MS + 1), now), false);
  assert.equal(isDue(new Date(now.getTime() + 60_000), now), false, "a clock set back does not make it due");
});

test("a failure is stored in words with no address in them", () => {
  assert.equal(safeSyncError(new AppError("INTEGRATION_ERROR", "The calendar returned 404.")), "The calendar returned 404.");
  assert.equal(safeSyncError(new Error("connect ECONNREFUSED 10.0.0.5:5432")), "The sync failed.");
  assert.equal(safeSyncError("boom"), "The sync failed.");
  const leaky = safeSyncError(new AppError("INTEGRATION_ERROR", "Could not fetch https://calendar.google.com/calendar/ical/me/private-abc123/basic.ics now"));
  assert.ok(!leaky.includes("abc123") && !leaky.includes("http"), leaky);
  assert.ok(safeSyncError(new AppError("INTEGRATION_ERROR", "x".repeat(5000))).length <= 200);
});

test("every provider has steps for finding its link, and the Google and Outlook ones name where to click", () => {
  for (const id of ["google", "outlook", "apple", "other"] as const) {
    assert.ok(PROVIDER_STEPS[id].title.length > 0 && PROVIDER_STEPS[id].steps.length >= 2, id);
  }
  assert.match(PROVIDER_STEPS.google.steps.join(" "), /Secret address in iCal format/);
  assert.match(PROVIDER_STEPS.outlook.steps.join(" "), /Publish a calendar/);
  assert.match(PROVIDER_STEPS.outlook.note ?? "", /administrator|school|university/i);
});
