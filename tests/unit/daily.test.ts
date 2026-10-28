import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_TAG,
  buildDailyNote,
  carryDetail,
  dailyTitle,
  planCarryOver,
  tomorrowDue,
  type CarryTask,
} from "@/lib/daily";

const DAY = new Date(2026, 9, 28, 14, 5); // Wed 28 Oct 2026, local time
/** A local time on the day `dayOffset` days from DAY. */
const at = (hour: number, minute: number, dayOffset = 0) =>
  new Date(2026, 9, 28 + dayOffset, hour, minute);

test("the title is the local ISO date", () => {
  assert.equal(dailyTitle(new Date(2026, 9, 28, 23, 59)), "2026-10-28");
  assert.equal(dailyTitle(new Date(2026, 0, 5, 0, 1)), "2026-01-05");
  assert.equal(DAILY_TAG, "daily");
});

test("a day with an event, a planned block and three tasks matches the approved design", () => {
  assert.equal(
    buildDailyNote({
      day: DAY,
      events: [{ title: "ML midterm", start: at(9, 0), end: at(11, 0), location: "Hall C" }],
      blocks: [{ title: "Draft related-work section", start: at(14, 0), end: at(15, 0) }],
      tasks: [
        { title: "Draft related-work section", priority: "high" },
        { title: "Review week 6 slides", priority: "medium" },
        { title: "Email supervisor about thesis topic", priority: "low" },
      ],
    }),
    [
      "## Schedule",
      "- 09:00–11:00 ML midterm, Hall C",
      "- 14:00–15:00 Draft related-work section (planned)",
      "",
      "## Open tasks",
      "- [ ] Draft related-work section (high, due today)",
      "- [ ] Review week 6 slides (medium, due today)",
      "- [ ] Email supervisor about thesis topic (low, due today)",
      "",
      "## Notes",
      "",
    ].join("\n"),
  );
});

test("an empty day says so instead of leaving empty lists", () => {
  assert.equal(
    buildDailyNote({ day: DAY, events: [], blocks: [], tasks: [] }),
    "## Schedule\nNothing scheduled.\n\n## Open tasks\nNo open tasks due today.\n\n## Notes\n",
  );
});

test("the schedule is in time order, an event before a block that starts with it", () => {
  const out = buildDailyNote({
    day: DAY,
    events: [
      { title: "Lab", start: at(16, 0), end: at(17, 0), location: null },
      { title: "Stand-up", start: at(9, 0), end: at(9, 15), location: null },
    ],
    blocks: [{ title: "Read paper", start: at(9, 0), end: at(10, 0) }],
    tasks: [],
  });
  assert.deepEqual(out.split("\n").slice(1, 4), [
    "- 09:00–09:15 Stand-up",
    "- 09:00–10:00 Read paper (planned)",
    "- 16:00–17:00 Lab",
  ]);
});

test("an event that crosses the day's edges is described honestly", () => {
  const out = buildDailyNote({
    day: DAY,
    events: [
      { title: "Conference", start: at(9, 0, -1), end: at(17, 0, 1), location: null },
      { title: "Night shift", start: at(22, 0, -1), end: at(2, 0), location: null },
      { title: "Overnight lab", start: at(22, 0), end: at(3, 0, 1), location: null },
    ],
    blocks: [],
    tasks: [],
  });
  assert.ok(out.includes("- All day Conference"), out);
  assert.ok(out.includes("- until 02:00 Night shift"), out);
  assert.ok(out.includes("- from 22:00 Overnight lab"), out);
});

const NOW = new Date(2026, 9, 28, 18, 0); // Wed 28 Oct 2026, 18:00 local
const task = (over: Partial<CarryTask> = {}): CarryTask => ({
  id: "t",
  title: "A task",
  priority: "medium",
  status: "todo",
  dueDate: null,
  scheduledStart: null,
  scheduledEnd: null,
  ...over,
});

test("open tasks due today and overdue ones are listed; the rest are not", () => {
  const plan = planCarryOver(
    [
      task({ id: "today-9", dueDate: at(9, 0) }),
      task({ id: "today-late", dueDate: new Date(2026, 9, 28, 23, 59) }),
      task({ id: "yesterday", dueDate: new Date(2026, 9, 27, 23, 59) }),
      task({ id: "tomorrow", dueDate: at(0, 0, 1) }),
      task({ id: "undated" }),
      task({ id: "done", dueDate: at(9, 0), status: "done" }),
    ],
    NOW,
  );
  assert.deepEqual(plan.dueToday.map((t) => t.id), ["today-9", "today-late"]);
  assert.deepEqual(plan.overdue.map((t) => t.id), ["yesterday"]);
});

test("an in-progress task counts as unfinished", () => {
  const plan = planCarryOver([task({ id: "wip", dueDate: at(9, 0), status: "in_progress" })], NOW);
  assert.deepEqual(plan.dueToday.map((t) => t.id), ["wip"]);
});

test("a block that starts today is reported so it can be cleared; one tomorrow is not", () => {
  const plan = planCarryOver(
    [
      task({ id: "a", dueDate: at(9, 0), scheduledStart: at(14, 0), scheduledEnd: at(15, 0) }),
      task({ id: "b", dueDate: at(9, 0), scheduledStart: at(14, 0, 1), scheduledEnd: at(15, 0, 1) }),
    ],
    NOW,
  );
  assert.deepEqual([plan.dueToday[0].plannedStart, plan.dueToday[0].plannedEnd], [at(14, 0), at(15, 0)]);
  assert.deepEqual([plan.dueToday[1].plannedStart, plan.dueToday[1].plannedEnd], [null, null]);
});

test("tomorrowDue keeps the time of day; an overdue task lands on tomorrow, not the day after its old date", () => {
  assert.deepEqual(
    tomorrowDue(new Date(2026, 9, 28, 23, 59, 59, 999), NOW),
    new Date(2026, 9, 29, 23, 59, 59, 999),
  );
  assert.deepEqual(tomorrowDue(new Date(2026, 9, 26, 9, 30), NOW), new Date(2026, 9, 29, 9, 30));
});

test("tomorrowDue rolls over a month end and does not move at 00:30", () => {
  const lateOct = new Date(2026, 9, 31, 12, 0);
  assert.deepEqual(tomorrowDue(new Date(2026, 9, 31, 23, 59), lateOct), new Date(2026, 10, 1, 23, 59));
  assert.deepEqual(
    tomorrowDue(new Date(2026, 9, 28, 9, 0), new Date(2026, 9, 28, 0, 30)),
    new Date(2026, 9, 29, 9, 0),
  );
});

test("the detail line names a planned time that will be cleared and an overdue task's old date", () => {
  const item = {
    id: "x",
    title: "t",
    priority: "high",
    dueDate: at(9, 0),
    plannedStart: at(14, 0),
    plannedEnd: at(15, 0),
  };
  assert.equal(carryDetail(item, "dueToday"), "planned 14:00–15:00, will be cleared");
  assert.equal(carryDetail({ ...item, plannedStart: null, plannedEnd: null }, "dueToday"), "");
  const old = { ...item, dueDate: new Date(2026, 9, 26, 9, 0), plannedStart: null, plannedEnd: null };
  assert.equal(carryDetail(old, "overdue"), "due Mon 26 Oct");
  assert.equal(
    carryDetail({ ...old, plannedStart: at(14, 0), plannedEnd: at(15, 0) }, "overdue"),
    "due Mon 26 Oct, planned 14:00–15:00, will be cleared",
  );
});
