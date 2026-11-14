/**
 * Uptime and error alerts (ROADMAP item 29): the rules in ops/watch.mjs, and the publisher against a real
 * local HTTP server standing in for ntfy. No Docker, no real ntfy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { decide, parseEnv, publish, EMPTY_STATE, THRESHOLD, WATCH_CHECKS } from "../../ops/watch.mjs";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const healthy = {
  app: { up: true, detail: "" },
  reminders: { configured: true, lastTickSecondsAgo: 30 },
  ntfy: { up: true, detail: "" },
  backup: { ageHours: 5, detail: "" },
  offsite: { fresh: true, detail: "" },
};
const with_ = (changes: Record<string, unknown>) => ({ ...healthy, ...changes }) as typeof healthy;

test("a healthy check sends nothing and keeps no failures", () => {
  const { state, alerts } = decide(EMPTY_STATE, healthy, NOW);
  assert.deepEqual(alerts, []);
  for (const check of WATCH_CHECKS) assert.deepEqual(state[check], { failures: 0, alerted: false }, check);
});

test("one failing run is a blip: nothing is sent until the threshold is reached", () => {
  const first = decide(EMPTY_STATE, with_({ app: { up: false, detail: "answered 503" } }), NOW);
  assert.equal(THRESHOLD, 2);
  assert.deepEqual(first.alerts, []);
  assert.equal(first.state.app.failures, 1);
  const second = decide(first.state, with_({ app: { up: false, detail: "answered 503" } }), NOW + 300_000);
  assert.equal(second.alerts.length, 1);
  assert.equal(second.alerts[0].title, "Anamnesis: the app is not answering");
  assert.match(second.alerts[0].body, /answered 503/);
});

test("a long outage is one message; the message is not repeated while it lasts", () => {
  let state = EMPTY_STATE;
  const sent: string[] = [];
  for (let run = 0; run < 12; run++) {
    const out = decide(state, with_({ app: { up: false, detail: "timed out" } }), NOW + run * 300_000);
    state = out.state;
    sent.push(...out.alerts.map((a) => a.title));
  }
  assert.deepEqual(sent, ["Anamnesis: the app is not answering"]);
});

test("recovery after an alert is told once; recovery before the threshold is silent", () => {
  let state = EMPTY_STATE;
  for (let run = 0; run < 2; run++) state = decide(state, with_({ app: { up: false, detail: "timed out" } }), NOW).state;
  const back = decide(state, healthy, NOW + 600_000);
  assert.deepEqual(back.alerts.map((a) => a.title), ["Anamnesis: the app is answering again"]);
  assert.deepEqual(decide(back.state, healthy, NOW + 900_000).alerts, [], "not repeated");

  const blip = decide(decide(EMPTY_STATE, with_({ app: { up: false, detail: "x" } }), NOW).state, healthy, NOW);
  assert.deepEqual(blip.alerts, [], "a single failure that recovers is never announced");
  assert.equal(blip.state.app.failures, 0);
});

test("flapping (fail, recover, fail, recover) sends nothing at all", () => {
  let state = EMPTY_STATE;
  const alerts: string[] = [];
  for (let run = 0; run < 10; run++) {
    const out = decide(state, run % 2 === 0 ? with_({ app: { up: false, detail: "x" } }) : healthy, NOW + run * 300_000);
    state = out.state;
    alerts.push(...out.alerts.map((a) => a.title));
  }
  assert.deepEqual(alerts, []);
});

test("the scheduler that has stopped ticking is an alert; one that is not configured is not", () => {
  const stalled = { reminders: { configured: true, lastTickSecondsAgo: 900 } };
  let state = EMPTY_STATE;
  for (let run = 0; run < 2; run++) state = decide(state, with_(stalled), NOW).state;
  assert.equal(state.reminders.alerted, true);
  const off = decide(EMPTY_STATE, with_({ reminders: { configured: false, lastTickSecondsAgo: null } }), NOW);
  assert.equal(off.state.reminders.failures, 0);
  const starting = decide(EMPTY_STATE, with_({ reminders: { configured: true, lastTickSecondsAgo: null } }), NOW);
  assert.equal(starting.state.reminders.failures, 0, "no tick yet is not a stall");
});

test("a backup that did not happen for more than 26 hours is an alert; no backup folder at all is too", () => {
  let state = EMPTY_STATE;
  for (let run = 0; run < 2; run++) state = decide(state, with_({ backup: { ageHours: 27, detail: "" } }), NOW).state;
  assert.equal(state.backup.alerted, true);
  const none = decide(decide(EMPTY_STATE, with_({ backup: { ageHours: null, detail: "no backup yet" } }), NOW).state, with_({ backup: { ageHours: null, detail: "no backup yet" } }), NOW);
  assert.equal(none.alerts[0].title, "Anamnesis: no backup has been made");
  const tonight = decide(EMPTY_STATE, with_({ backup: { ageHours: 26, detail: "" } }), NOW);
  assert.equal(tonight.state.backup.failures, 0, "a day and a bit is still in time");
});

test("off-site copies that are not arriving are an alert, and not checked when they are not configured", () => {
  let state = EMPTY_STATE;
  for (let run = 0; run < 2; run++) state = decide(state, with_({ offsite: { fresh: false, detail: "the newest copy is 5 days old" } }), NOW).state;
  assert.equal(state.offsite.alerted, true);
  const unconfigured = decide(EMPTY_STATE, with_({ offsite: { fresh: null, detail: "" } }), NOW);
  assert.equal(unconfigured.state.offsite.failures, 0);
});

test("without the phone server configured, its check is silent, even though nothing answers", () => {
  let state = EMPTY_STATE;
  for (let run = 0; run < 3; run++) state = decide(state, with_({ ntfy: { configured: false, up: false, detail: "not configured" } }), NOW).state;
  assert.deepEqual(state.ntfy, { failures: 0, alerted: false });
});

test("a backup alert is not repeated while the backup stays missing, and a fresh one ends it", () => {
  let state = EMPTY_STATE;
  const titles: string[] = [];
  for (let run = 0; run < 4; run++) {
    const out = decide(state, with_({ backup: { ageHours: 40, detail: "" } }), NOW + run * 300_000);
    state = out.state;
    titles.push(...out.alerts.map((a) => a.title));
  }
  const back = decide(state, healthy, NOW + 1_500_000);
  titles.push(...back.alerts.map((a) => a.title));
  assert.deepEqual(titles, ["Anamnesis: no recent backup", "Anamnesis: backups are being made again"]);
});

test("a check switched off after it alerted stays as it was: no recovery message is invented for it", () => {
  let state = EMPTY_STATE;
  for (let run = 0; run < 2; run++) state = decide(state, with_({ offsite: { fresh: false, detail: "old" } }), NOW).state;
  const off = decide(state, with_({ offsite: { fresh: null, detail: "" } }), NOW);
  assert.deepEqual(off.alerts, []);
  assert.deepEqual(off.state.offsite, { failures: 0, alerted: true });
  let phone = EMPTY_STATE;
  for (let run = 0; run < 2; run++) phone = decide(phone, with_({ ntfy: { configured: true, up: false, detail: "x" } }), NOW).state;
  const unset = decide(phone, with_({ ntfy: { configured: false, up: false, detail: "" } }), NOW);
  assert.deepEqual(unset.alerts, []);
  assert.deepEqual(unset.state.ntfy, { failures: 0, alerted: true });
});

test("the state is only the counts and flags, so it can be written and read back", () => {
  const out = decide(EMPTY_STATE, with_({ app: { up: false, detail: "timed out" } }), NOW);
  assert.deepEqual(JSON.parse(JSON.stringify(out.state)), out.state);
  assert.ok(!JSON.stringify(out.state).includes("timed out"), "no message text is kept in the state");
});

test("the env file is read as data: values, quotes and comments, never run", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "watch-env-"));
  try {
    const file = path.join(dir, "env");
    writeFileSync(file, [
      "# a comment",
      "NTFY_APP_TOKEN=tk_abc",
      "NTFY_APP_PASSWORD_HASH='$2b$12$hash'",
      "ALERT_TOPIC=anamnesis-ops-x",
      "OFFSITE_DIR=$(touch /tmp/pwned-watch)",
      "",
    ].join("\n"));
    const env = parseEnv(file);
    assert.equal(env.NTFY_APP_TOKEN, "tk_abc");
    assert.equal(env.NTFY_APP_PASSWORD_HASH, "$2b$12$hash");
    assert.equal(env.OFFSITE_DIR, "$(touch /tmp/pwned-watch)", "kept as text");
    assert.equal(spawnSync("test", ["-e", "/tmp/pwned-watch"]).status, 1, "never executed");
    assert.deepEqual(parseEnv(path.join(dir, "missing")), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A stand-in for the ntfy server that records what it was sent and answers with a status we choose. */
async function fakeNtfy(status: number) {
  const received: { auth: string | undefined; body: unknown }[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      received.push({ auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
      res.writeHead(status, { "Content-Type": "text/plain" });
      res.end(status === 200 ? '{"id":"x"}' : "denied: token secret-xyz");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, received, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("publish sends one JSON message with the app's token, to the topic, and reports a refusal without the reply", async () => {
  const ok = await fakeNtfy(200);
  try {
    await publish({ url: ok.url, token: "tk_secret", topic: "anamnesis-ops-x", title: "T", body: "B" });
    assert.equal(ok.received.length, 1);
    assert.equal(ok.received[0].auth, "Bearer tk_secret");
    assert.deepEqual(ok.received[0].body, { topic: "anamnesis-ops-x", title: "T", message: "B", tags: [], priority: 3 });
  } finally {
    await ok.close();
  }
  const denied = await fakeNtfy(401);
  try {
    await assert.rejects(() => publish({ url: denied.url, token: "tk_secret", topic: "anamnesis-ops-x", title: "T", body: "B" }), (error: Error) => {
      assert.equal(error.message, "ntfy answered 401");
      assert.ok(!error.message.includes("secret-xyz") && !error.message.includes("tk_secret"));
      return true;
    });
  } finally {
    await denied.close();
  }
});

test("publish says why no answer came, in words that carry no address", async () => {
  await assert.rejects(() => publish({ url: "http://127.0.0.1:1", token: "t", topic: "anamnesis-ops-x", title: "T", body: "B" }), (error: Error) => {
    assert.match(error.message, /^ntfy did not answer \(/);
    assert.ok(!error.message.includes("127.0.0.1"));
    return true;
  });
});

test("--notify sends one message from the command line and exits 0 even when ntfy cannot be reached", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "watch-notify-"));
  try {
    const envFile = path.join(dir, "env");
    writeFileSync(envFile, "NTFY_APP_TOKEN=tk_x\nALERT_TOPIC=anamnesis-ops-x\nNTFY_PORT=1\n");
    const out = spawnSync(process.execPath, [path.join(process.cwd(), "ops/watch.mjs"), "--notify", "Backup failed", "the nightly backup stopped"], {
      encoding: "utf8",
      env: { ...process.env, ANAMNESIS_ENV_FILE: envFile, ANAMNESIS_STATE_DIR: dir },
    });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stderr, /could not send/);
    assert.ok(!out.stderr.includes("tk_x") && !out.stdout.includes("tk_x"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--notify with no alert topic configured sends nothing and says so", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "watch-none-"));
  try {
    const envFile = path.join(dir, "env");
    writeFileSync(envFile, "NTFY_APP_TOKEN=tk_x\n");
    const out = spawnSync(process.execPath, [path.join(process.cwd(), "ops/watch.mjs"), "--notify", "T", "B"], {
      encoding: "utf8",
      env: { ...process.env, ANAMNESIS_ENV_FILE: envFile, ANAMNESIS_STATE_DIR: dir },
    });
    assert.equal(out.status, 0);
    assert.match(out.stderr, /ALERT_TOPIC is not set/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
