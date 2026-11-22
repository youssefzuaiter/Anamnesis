import { test } from "node:test";
import assert from "node:assert/strict";
import { areaOf, parseAreas, parseAreaFilter, keepForFilter, navGroupsFor, mobileMoreFor, categoryArea } from "@/lib/areas";
import { NAV_GROUPS } from "@/components/nav-items";

test("what is stored is School unless it is exactly work or both", () => {
  assert.equal(parseAreas(null), "school");
  assert.equal(parseAreas("work"), "work");
  assert.equal(parseAreas("both"), "both");
  for (const bad of ["", "WORK", "school ", "all", undefined, 3, {}]) assert.equal(parseAreas(bad), "school");
});

test("a project category is School, Work or neither", () => {
  assert.equal(categoryArea("University"), "school");
  assert.equal(categoryArea("Work"), "work");
  assert.equal(categoryArea("Career"), "work");
  assert.equal(categoryArea("Personal"), null);
  assert.equal(categoryArea("anything else"), null);
});

test("an item is School with a course, else Work through a work project, else neither", () => {
  const cats = new Map([["p-work", "Work"], ["p-uni", "University"], ["p-me", "Personal"]]);
  assert.equal(areaOf({ courseId: "c1", projectId: null }, cats), "school");
  assert.equal(areaOf({ courseId: null, projectId: "p-work" }, cats), "work");
  assert.equal(areaOf({ courseId: null, projectId: "p-uni" }, cats), "school");
  assert.equal(areaOf({ courseId: null, projectId: "p-me" }, cats), null);
  assert.equal(areaOf({ courseId: null, projectId: "unknown" }, cats), null);
  assert.equal(areaOf({ courseId: null, projectId: null }, cats), null);
  assert.equal(areaOf({ courseId: "c1", projectId: "p-work" }, cats), "school", "a course wins");
});

test("the filter only exists when both areas are on, and only exact values count", () => {
  assert.equal(parseAreaFilter("work", "both"), "work");
  assert.equal(parseAreaFilter("school", "both"), "school");
  assert.equal(parseAreaFilter("work", "school"), "all");
  assert.equal(parseAreaFilter("work", "work"), "all");
  for (const bad of ["", "Work", "both", undefined, ["work"], 5]) assert.equal(parseAreaFilter(bad, "both"), "all");
});

test("filtering keeps items of that area; items in neither area always stay", () => {
  assert.equal(keepForFilter("school", "all"), true);
  assert.equal(keepForFilter("school", "work"), false);
  assert.equal(keepForFilter("work", "work"), true);
  assert.equal(keepForFilter(null, "work"), true);
  assert.equal(keepForFilter(null, "school"), true);
});

test("the menu hides Study pages when School is off, and nothing else", () => {
  const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
  for (const areas of ["school", "both"] as const) assert.deepEqual(navGroupsFor(areas).flatMap((g) => g.items.map((i) => i.href)), all);
  const work = navGroupsFor("work").flatMap((g) => g.items.map((i) => i.href));
  for (const gone of ["/courses", "/cards", "/review", "/stats"]) assert.ok(!work.includes(gone), gone);
  for (const kept of ["/", "/tasks", "/calendar", "/plan", "/projects", "/goals", "/references", "/settings"]) assert.ok(work.includes(kept), kept);
  assert.ok(!mobileMoreFor("work").some((i) => i.href === "/courses"));
  assert.ok(mobileMoreFor("both").some((i) => i.href === "/courses"));
});
