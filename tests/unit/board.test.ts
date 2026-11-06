import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_COLUMNS,
  DONE_SHOWN,
  columnsOf,
  moveCard,
  otherColumns,
  sortCards,
  toBoardCards,
  type BoardTask,
} from "@/lib/board";
import { BOARD_DRAG_MIME, TASK_DRAG_MIME } from "@/lib/domain";

// Local times throughout, as the rest of the app: a bare date is the local day.
const NOW = new Date(2026, 10, 6, 12, 0, 0);
const day = (d: number, h = 9) => new Date(2026, 10, d, h, 0, 0);

let serial = 0;
function task(over: Partial<BoardTask> = {}): BoardTask {
  serial += 1;
  return {
    id: `id-${String(serial).padStart(4, "0")}`,
    title: `Task ${serial}`,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimatedMinutes: 60,
    recurrenceId: null,
    createdAt: new Date(2026, 9, 1, 0, 0, serial),
    completedAt: null,
    ...over,
  };
}

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);
const none = new Map();

test("the board has three columns in a fixed order, a Done limit and its own drag type", () => {
  assert.deepEqual(BOARD_COLUMNS, [
    { status: "todo", label: "To do" },
    { status: "in_progress", label: "In progress" },
    { status: "done", label: "Done" },
  ]);
  assert.equal(DONE_SHOWN, 10);
  // A board card must not light up the calendar's drop targets, which look for the task type.
  assert.notEqual(BOARD_DRAG_MIME, TASK_DRAG_MIME);
});

test("an open column is ordered by due date (none last), then priority, then created, then id", () => {
  const laterLow = task({ dueDate: day(12), priority: "low" });
  const earlyLow = task({ dueDate: day(10), priority: "low" });
  const noDateHigh = task({ priority: "high" });
  const earlyHighNewer = task({ dueDate: day(10), priority: "high", createdAt: new Date(2026, 9, 5) });
  const earlyHighOlder = task({ dueDate: day(10), priority: "high", createdAt: new Date(2026, 9, 2) });
  const earlyMedium = task({ dueDate: day(10), priority: "medium" });
  const cards = toBoardCards([laterLow, earlyLow, noDateHigh, earlyHighNewer, earlyHighOlder, earlyMedium], NOW, none);
  assert.deepEqual(ids(cards), [earlyHighOlder.id, earlyHighNewer.id, earlyMedium.id, earlyLow.id, laterLow.id, noDateHigh.id]);

  // Two tasks the same in every other way fall back to their ids, so the order is one order.
  const stamp = new Date(2026, 9, 3);
  const a = task({ id: "aaa", createdAt: stamp });
  const b = task({ id: "bbb", createdAt: stamp });
  assert.deepEqual(ids(toBoardCards([b, a], NOW, none)), ["aaa", "bbb"]);
});

test("Done is ordered by when it was finished, newest first, and the columns come in board order", () => {
  const old = task({ status: "done", completedAt: day(3) });
  const recent = task({ status: "done", completedAt: day(5) });
  const unstamped = task({ status: "done", completedAt: null });
  const doing = task({ status: "in_progress" });
  const todo = task({ status: "todo" });
  const cards = toBoardCards([old, unstamped, recent, doing, todo], NOW, none);
  assert.deepEqual(ids(cards), [todo.id, doing.id, recent.id, old.id, unstamped.id]);
});

test("a card says what a person sees: the due day, whether it is past due, its steps, its repeat", () => {
  const counts = new Map([["steps", { done: 2, total: 5 }], ["empty", { done: 0, total: 0 }]]);
  const cards = toBoardCards(
    [
      task({ id: "future", dueDate: day(14) }),
      task({ id: "yesterday", dueDate: day(5) }),
      task({ id: "today-early", dueDate: day(6, 9) }),
      task({ id: "undated" }),
      task({ id: "steps" }),
      task({ id: "empty" }),
      task({ id: "series", recurrenceId: "r1" }),
      task({ id: "finished-late", status: "done", dueDate: day(2), completedAt: day(4) }),
    ],
    NOW,
    counts,
  );
  const by = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.equal(by.future.dueLabel, "14 Nov");
  assert.equal(by.future.pastDue, false);
  assert.equal(by.yesterday.pastDue, true);
  assert.equal(by["today-early"].pastDue, false, "due this morning is still today");
  assert.equal(by.undated.dueLabel, null);
  assert.equal(by.undated.pastDue, false);
  assert.deepEqual(by.steps.checklist, { done: 2, total: 5 });
  assert.equal(by.empty.checklist, null, "no steps, no badge");
  assert.equal(by.undated.checklist, null);
  assert.equal(by.series.recurring, true);
  assert.equal(by.undated.recurring, false);
  assert.equal(by["finished-late"].pastDue, true, "past due is a fact about the date; the page decides to show it only while open");
});

test("a status or priority the app never writes is read as the safe one", () => {
  const [card] = toBoardCards([task({ status: "weird", priority: "urgent" })], NOW, none);
  assert.equal(card.status, "todo");
  assert.equal(card.priority, "medium");
});

test("a priority that is only a property every object has is not a priority", () => {
  // `"constructor" in { high: 0 }` is true: the check has to be about the three priorities, not about the object.
  for (const odd of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const [card] = toBoardCards([task({ priority: odd })], NOW, none);
    assert.equal(card.priority, "medium", odd);
  }
  const cards = toBoardCards([task({ priority: "constructor", dueDate: day(10) }), task({ priority: "high", dueDate: day(10) }), task({ priority: "low", dueDate: day(10) })], NOW, none);
  assert.deepEqual(cards.map((c) => c.priority), ["high", "medium", "low"], "the order is still an order");
});

test("moving a card changes its column and its finished time, and nothing else", () => {
  const t = task({ dueDate: day(10), priority: "high" });
  const cards = toBoardCards([t, task()], NOW, none);
  const AT = day(6, 15).getTime();

  const done = moveCard(cards, t.id, "done", AT);
  const finished = done.find((c) => c.id === t.id)!;
  assert.equal(finished.status, "done");
  assert.equal(finished.completedAt, AT);
  assert.equal(finished.title, t.title);
  assert.equal(finished.dueLabel, "10 Nov");

  const reopened = moveCard(done, t.id, "in_progress", AT + 1000).find((c) => c.id === t.id)!;
  assert.equal(reopened.status, "in_progress");
  assert.equal(reopened.completedAt, null);

  assert.deepEqual(moveCard(cards, t.id, "todo", AT), cards, "to the column it is in: nothing");
  assert.equal(moveCard(done, t.id, "done", AT + 5000).find((c) => c.id === t.id)!.completedAt, AT, "a finished card sent to Done keeps when it finished");
  assert.deepEqual(moveCard(cards, "no-such-id", "done", AT), cards, "an unknown card: nothing");
  assert.equal(cards.find((c) => c.id === t.id)!.status, "todo", "the input is not changed");
});

test("the optimistic move lands exactly where the refreshed list will put the card", () => {
  // If the browser's order and the server's differed, the card would jump when the page refreshed.
  const tasks = [
    task({ dueDate: day(9), priority: "low" }),
    task({ dueDate: day(8), priority: "high" }),
    task({ priority: "medium" }),
    task({ status: "in_progress", dueDate: day(7), priority: "medium" }),
    task({ status: "done", completedAt: day(4) }),
  ];
  const AT = day(6, 15).getTime();
  const before = toBoardCards(tasks, NOW, none);
  for (const target of ["todo", "in_progress", "done"] as const) {
    for (const t of tasks) {
      // Not a move: the board never sends a card to the column it is in (the server would stamp it again).
      if (t.status === target) continue;
      const moved = moveCard(before, t.id, target, AT);
      const after = tasks.map((x) =>
        x.id === t.id ? { ...x, status: target, completedAt: target === "done" ? new Date(AT) : null } : x,
      );
      assert.deepEqual(moved, toBoardCards(after, NOW, none), `${t.id} to ${target}`);
    }
  }
});

test("columnsOf always gives the three columns, each in its order", () => {
  assert.deepEqual(columnsOf([]).map((c) => [c.status, c.label, c.cards.length]), [["todo", "To do", 0], ["in_progress", "In progress", 0], ["done", "Done", 0]]);
  const a = task({ status: "done", completedAt: day(2) });
  const b = task();
  const c = task({ status: "done", completedAt: day(4) });
  const cols = columnsOf(toBoardCards([a, b, c], NOW, none));
  assert.deepEqual(ids(cols[0].cards), [b.id]);
  assert.deepEqual(ids(cols[1].cards), []);
  assert.deepEqual(ids(cols[2].cards), [c.id, a.id]);
});

test("the other columns are the two a card can go to, in board order", () => {
  assert.deepEqual(otherColumns("todo").map((c) => c.status), ["in_progress", "done"]);
  assert.deepEqual(otherColumns("in_progress").map((c) => c.status), ["todo", "done"]);
  assert.deepEqual(otherColumns("done").map((c) => c.status), ["todo", "in_progress"]);
  assert.deepEqual(otherColumns("in_progress").map((c) => c.label), ["To do", "Done"]);
});

test("sorting does not change what it is given", () => {
  const unsorted = [...toBoardCards([task({ dueDate: day(12) }), task({ dueDate: day(10) })], NOW, none)].reverse();
  const snapshot = structuredClone(unsorted);
  const sorted = sortCards(unsorted);
  assert.deepEqual(unsorted, snapshot, "the array it was given is untouched");
  assert.notDeepEqual(sorted, unsorted);
});

test("a project of 5,000 tasks is built, sorted and moved in milliseconds", () => {
  const many = Array.from({ length: 5000 }, (_, i) =>
    task({ status: ["todo", "in_progress", "done"][i % 3], dueDate: i % 4 ? day(1 + (i % 28)) : null, completedAt: i % 3 === 2 ? day(1 + (i % 5)) : null }),
  );
  const start = performance.now();
  const cards = toBoardCards(many, NOW, none);
  const moved = moveCard(cards, many[1234].id, "done", day(6).getTime());
  columnsOf(moved);
  const took = performance.now() - start;
  assert.ok(took < 150, `took ${took.toFixed(0)} ms`);
});
