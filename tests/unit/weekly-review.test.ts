/** The weekly review's counting rules (ROADMAP item 31). Pure: no database. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tasksPerCourse, tasksPerGoal } from "@/lib/weekly-review";

test("a task reached by a goal both directly and through a project counts once for that goal", () => {
  const counts = tasksPerGoal([
    { id: "t1", goalId: "g1", projectGoalId: "g1" },
    { id: "t2", goalId: "g1", projectGoalId: null },
    { id: "t3", goalId: null, projectGoalId: "g1" },
  ]);
  assert.equal(counts.get("g1"), 3);
});

test("a task with no goal, direct or through a project, counts for none", () => {
  assert.deepEqual([...tasksPerGoal([{ id: "t1", goalId: null, projectGoalId: null }])], []);
});

test("two goals each count only their own tasks", () => {
  const counts = tasksPerGoal([
    { id: "t1", goalId: "g1", projectGoalId: null },
    { id: "t2", goalId: null, projectGoalId: "g2" },
  ]);
  assert.equal(counts.get("g1"), 1);
  assert.equal(counts.get("g2"), 1);
});

test("tasks per course count the tasks that have a course, once each", () => {
  const counts = tasksPerCourse([{ courseId: "c1" }, { courseId: "c1" }, { courseId: null }, { courseId: "c2" }]);
  assert.equal(counts.get("c1"), 2);
  assert.equal(counts.get("c2"), 1);
  assert.equal(counts.has("null"), false);
  assert.equal(counts.size, 2);
});
