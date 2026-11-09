import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MAX_SESSION_SECONDS } from "@/lib/focus";
import { switchSchema, timerSessionSchema, writingSessionSchema } from "@/lib/focus-input";

// These are what a browser is allowed to send: the actions parse with them before anything else runs, so
// a number or an id outside them never reaches the service. (The service's own rules are in
// tests/integration/study-time.test.ts.)

const valid = { activeSeconds: 120, charactersTyped: 600, typingSpeedWpm: 50 };
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => schema.safeParse(value).success;

test("a writing session is three bounded whole numbers and, optionally, a course id", () => {
  assert.ok(ok(writingSessionSchema, valid));
  assert.ok(ok(writingSessionSchema, { ...valid, activeSeconds: 0, charactersTyped: 0, typingSpeedWpm: 0 }));
  assert.ok(ok(writingSessionSchema, { ...valid, activeSeconds: MAX_SESSION_SECONDS }));
  assert.ok(ok(writingSessionSchema, { ...valid, charactersTyped: 1_000_000 }));
  assert.ok(ok(writingSessionSchema, { ...valid, typingSpeedWpm: 400 }));

  assert.ok(!ok(writingSessionSchema, { ...valid, activeSeconds: MAX_SESSION_SECONDS + 1 }), "over four hours");
  assert.ok(!ok(writingSessionSchema, { ...valid, charactersTyped: 1_000_001 }));
  assert.ok(!ok(writingSessionSchema, { ...valid, typingSpeedWpm: 401 }));
  for (const bad of [-1, 1.5, NaN, Infinity, "abc", {}, [MAX_SESSION_SECONDS + 1], String(MAX_SESSION_SECONDS + 1)]) {
    assert.ok(!ok(writingSessionSchema, { ...valid, activeSeconds: bad }), `activeSeconds ${JSON.stringify(bad)}`);
  }
  // Numbers sent as text are read as numbers, and the same bounds then apply.
  assert.ok(ok(writingSessionSchema, { ...valid, activeSeconds: "120" }));
  assert.ok(!ok(writingSessionSchema, { ...valid, charactersTyped: -1 }));
  assert.ok(!ok(writingSessionSchema, { ...valid, typingSpeedWpm: -1 }));
  for (const missing of ["activeSeconds", "charactersTyped", "typingSpeedWpm"]) {
    const copy: Record<string, unknown> = { ...valid };
    delete copy[missing];
    assert.ok(!ok(writingSessionSchema, copy), `without ${missing}`);
  }
  for (const nothing of [null, undefined, "x", 7, []]) assert.ok(!ok(writingSessionSchema, nothing), JSON.stringify(nothing));
});

test("a course id is a uuid, null or absent, and nothing else", () => {
  assert.ok(ok(writingSessionSchema, { ...valid, courseId: randomUUID() }));
  assert.ok(ok(writingSessionSchema, { ...valid, courseId: null }));
  assert.ok(ok(writingSessionSchema, { ...valid, courseId: undefined }));
  for (const bad of ["x", "", "'; DROP TABLE \"Course\"; --", `${randomUUID()} `, { id: randomUUID() }, [randomUUID()], 7, true]) {
    assert.ok(!ok(writingSessionSchema, { ...valid, courseId: bad }), JSON.stringify(bad));
  }
});

test("fields the schema does not know are dropped, so a smuggled owner never reaches the service", () => {
  const parsed = writingSessionSchema.parse({ ...valid, userId: "someone-else", sessionDuration: 1, cognitiveLoad: "deep" });
  assert.deepEqual(Object.keys(parsed).sort(), ["activeSeconds", "charactersTyped", "typingSpeedWpm"]);
  const timed = timerSessionSchema.parse({ taskId: randomUUID(), seconds: 900, userId: "someone-else", courseId: randomUUID() });
  assert.deepEqual(Object.keys(timed).sort(), ["seconds", "taskId"]);
});

test("a timer session is a task id and whole seconds within four hours", () => {
  const taskId = randomUUID();
  assert.ok(ok(timerSessionSchema, { taskId, seconds: 1500 }));
  assert.ok(ok(timerSessionSchema, { taskId, seconds: 0 }));
  assert.ok(ok(timerSessionSchema, { taskId, seconds: MAX_SESSION_SECONDS }));
  assert.ok(!ok(timerSessionSchema, { taskId, seconds: MAX_SESSION_SECONDS + 1 }));
  assert.ok(!ok(timerSessionSchema, { taskId, seconds: 99_999_999 }));
  for (const bad of [-1, 1500.5, NaN, Infinity, "abc", {}]) assert.ok(!ok(timerSessionSchema, { taskId, seconds: bad }), JSON.stringify(bad));
  for (const bad of ["x", "", undefined, null, 7, { id: taskId }, `${taskId}x`]) assert.ok(!ok(timerSessionSchema, { taskId: bad, seconds: 1500 }), JSON.stringify(bad));
  assert.ok(!ok(timerSessionSchema, { taskId }), "no seconds");
  assert.ok(!ok(timerSessionSchema, { seconds: 1500 }), "no task");
  assert.ok(!ok(timerSessionSchema, null));
});

test("a switch is a real boolean, not a string or an object that looks like one", () => {
  assert.ok(ok(switchSchema, true));
  assert.ok(ok(switchSchema, false));
  for (const bad of ["true", "false", 1, 0, null, undefined, { enabled: true }, [true]]) assert.ok(!ok(switchSchema, bad), JSON.stringify(bad));
});
