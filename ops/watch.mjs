#!/usr/bin/env node
/**
 * Uptime and error alerts (ROADMAP item 29). Run every five minutes by launchd, and by the failing backup
 * scripts with --notify. It checks what cannot report its own failure, and sends one message when a check
 * has failed on two runs in a row, and one when it recovers.
 *
 *   node ops/watch.mjs                       one pass: check, alert if needed, save the state
 *   node ops/watch.mjs --notify <title> <body>   send one alert now (used by the backup scripts)
 *
 * What it checks: the app answers (its deep health check); the reminder scheduler has ticked in the last
 * five minutes, when reminders are on; the ntfy server answers; a backup was made in the last 26 hours;
 * off-site copies are arriving (when they are configured). It cannot see a Mac that is off or asleep: then
 * nothing runs, and nothing can say so.
 *
 * Alerts go to ALERT_TOPIC (`anamnesis-ops-…`) through the same ntfy server and app token as reminders. That
 * topic is one the app may publish to and the phone may read, so the ntfy access rules need no change.
 *
 * Reads .env.production as data (never sourced), writes only ops/state/watch.json and ops/state/watch.log,
 * and never puts a token, a reply body or an address in a message or a log line. No dependencies.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseBackupName } from "./retention.mjs";

const OPS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(OPS_DIR);

/** Two failing runs in a row: ten minutes at the five-minute interval. One blip is never announced. */
export const THRESHOLD = 2;
export const WATCH_CHECKS = ["app", "reminders", "ntfy", "backup", "offsite"];
export const EMPTY_STATE = Object.freeze(
  Object.fromEntries(WATCH_CHECKS.map((check) => [check, { failures: 0, alerted: false }])),
);

const STALE_TICK_SECONDS = 5 * 60;
const BACKUP_MAX_HOURS = 26;

/**
 * One pass of the rules. `observations` is what was seen this run (see `main`); `state` is the last run's
 * counts and flags. Returns the new state and the alerts to send, in order. Pure: no I/O, no clock beyond `now`.
 *
 * @returns {{ state: Record<string, { failures: number, alerted: boolean }>, alerts: { check: string, kind: "fail" | "recover", title: string, body: string }[] }}
 */
export function decide(state, observations, now) {
  void now;
  const next = {};
  const alerts = [];
  for (const check of WATCH_CHECKS) {
    const before = state[check] ?? { failures: 0, alerted: false };
    const seen = describe(check, observations);
    if (!seen.applicable) {
      next[check] = { failures: 0, alerted: before.alerted };
      continue;
    }
    if (seen.bad) {
      const failures = before.failures + 1;
      const alerted = before.alerted || failures >= THRESHOLD;
      if (failures >= THRESHOLD && !before.alerted) {
        alerts.push({ check, kind: "fail", title: seen.failTitle, body: seen.detail });
      }
      next[check] = { failures, alerted };
    } else {
      if (before.alerted) {
        alerts.push({ check, kind: "recover", title: seen.recoverTitle, body: "The check passes again." });
      }
      next[check] = { failures: 0, alerted: false };
    }
  }
  return { state: next, alerts };
}

/** What each check means for this run's observations: whether it applies, whether it is bad, and its words. */
function describe(check, o) {
  switch (check) {
    case "app":
      return {
        applicable: true,
        bad: !o.app.up,
        detail: `The app did not pass its health check (${o.app.detail}). Phone reminders and the app itself are unavailable.`,
        failTitle: "Anamnesis: the app is not answering",
        recoverTitle: "Anamnesis: the app is answering again",
      };
    case "reminders": {
      const r = o.reminders;
      const stalled = r.configured && r.lastTickSecondsAgo !== null && r.lastTickSecondsAgo > STALE_TICK_SECONDS;
      return {
        applicable: r.configured,
        bad: stalled,
        detail: `The reminder scheduler last ran ${Math.round((r.lastTickSecondsAgo ?? 0) / 60)} minutes ago, so phone reminders are not being sent.`,
        failTitle: "Anamnesis: reminders have stopped",
        recoverTitle: "Anamnesis: reminders are running again",
      };
    }
    case "ntfy":
      return {
        applicable: o.ntfy.configured,
        bad: o.ntfy.configured && !o.ntfy.up,
        detail: `The phone server (ntfy) did not pass its health check (${o.ntfy.detail}), so phone alerts and reminders cannot be sent.`,
        failTitle: "Anamnesis: the phone server (ntfy) is not answering",
        recoverTitle: "Anamnesis: the phone server (ntfy) is answering again",
      };
    case "backup": {
      const b = o.backup;
      const missing = b.ageHours === null;
      const stale = !missing && b.ageHours > BACKUP_MAX_HOURS;
      return {
        applicable: true,
        bad: missing || stale,
        detail: missing ? "No backup folder was found, so nothing is being kept." : `The newest backup is ${Math.floor(b.ageHours)} hours old; a nightly backup should be made every day.`,
        failTitle: missing ? "Anamnesis: no backup has been made" : "Anamnesis: no recent backup",
        recoverTitle: "Anamnesis: backups are being made again",
      };
    }
    case "offsite":
      return {
        applicable: o.offsite.fresh !== null,
        bad: o.offsite.fresh === false,
        detail: `Encrypted off-site copies are not arriving (${o.offsite.detail}). Check that the drive is plugged in.`,
        failTitle: "Anamnesis: off-site copies are not arriving",
        recoverTitle: "Anamnesis: off-site copies are arriving again",
      };
    default:
      throw new Error(`unknown check ${check}`);
  }
}

/**
 * KEY=VALUE lines from the env file, read as text: quotes removed, nothing executed, a missing file is empty.
 * @param {string} file
 * @returns {Record<string, string>}
 */
export function parseEnv(file) {
  if (!existsSync(file)) return {};
  /** @type {Record<string, string>} */
  const values = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2];
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    values[match[1]] = value;
  }
  return values;
}

/** Why no answer came, in words with no address in them (the same rule as src/lib/ntfy.ts). */
function noAnswerReason(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "timed out";
  const code = error?.cause?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{2,40}$/.test(code) ? code : "network error";
}

/**
 * Sends one message to ntfy's root, as JSON, with the app's token. A failure is an Error whose message is
 * safe to show: the HTTP status, or "did not answer" and why. The reply is never kept.
 */
export async function publish({ url, token, topic, title, body }) {
  let response;
  try {
    response = await fetch(`${url.replace(/\/+$/, "")}/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ topic, title, message: body, tags: [], priority: 3 }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch (error) {
    throw new Error(`ntfy did not answer (${noAnswerReason(error)})`);
  }
  await response.text().catch(() => "");
  if (!response.ok) throw new Error(`ntfy answered ${response.status}`);
}

function settings() {
  const file = process.env.ANAMNESIS_ENV_FILE ?? path.join(ROOT, ".env.production");
  const fromFile = parseEnv(file);
  const get = (name, fallback = "") => process.env[name] ?? fromFile[name] ?? fallback;
  return {
    token: get("NTFY_APP_TOKEN"),
    topic: get("ALERT_TOPIC"),
    ntfyUrl: `http://127.0.0.1:${get("NTFY_PORT", "2586")}`,
    appUrl: `http://127.0.0.1:${get("ANAMNESIS_PORT", "3200")}`,
    backupDir: process.env.ANAMNESIS_BACKUP_DIR ?? path.join(os.homedir(), "anamnesis-backups"),
    offsiteConfigured: Boolean(get("OFFSITE_DIR")) || Boolean(get("OFFSITE_RECIPIENT")),
    stateDir: process.env.ANAMNESIS_STATE_DIR ?? path.join(OPS_DIR, "state"),
  };
}

function log(stateDir, line) {
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(path.join(stateDir, "watch.log"), `${new Date().toISOString()}  ${line}\n`, { mode: 0o600 });
  console.log(line);
}

async function sendAlert(cfg, title, body) {
  if (!cfg.token || !cfg.topic) return { sent: false, reason: "ALERT_TOPIC is not set, so nothing is sent" };
  try {
    await publish({ url: cfg.ntfyUrl, token: cfg.token, topic: cfg.topic, title, body });
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "could not send" };
  }
}

async function getJson(url, timeoutMs = 10_000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error", cache: "no-store" });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch (error) {
    return { status: null, reason: noAnswerReason(error) };
  }
}

/** What is true right now, in the shape `decide` reads. Each part answers for itself; nothing is assumed. */
export async function observe(cfg, now = new Date()) {
  const app = await getJson(`${cfg.appUrl}/api/health?deep=1`);
  const appUp = app.status === 200;
  const reminders = app.body?.checks?.reminders ?? null;

  const ntfyResult = cfg.token ? await getJson(`${cfg.ntfyUrl}/v1/health`, 5_000) : null;
  const ntfyUp = ntfyResult?.status === 200 && ntfyResult.body?.healthy === true;

  let ageHours = null;
  if (existsSync(cfg.backupDir)) {
    const dates = readdirSync(cfg.backupDir)
      .filter((name) => statSync(path.join(cfg.backupDir, name)).isDirectory())
      .map(parseBackupName)
      .filter(Boolean);
    if (dates.length) ageHours = (now - Math.max(...dates.map((d) => d.getTime()))) / 3_600_000;
  }

  let offsite = { fresh: null, detail: "" };
  if (cfg.offsiteConfigured) {
    const run = spawnSync("bash", [path.join(OPS_DIR, "offsite.sh"), "--check"], {
      encoding: "utf8",
      env: { ...process.env, ANAMNESIS_ENV_FILE: process.env.ANAMNESIS_ENV_FILE ?? path.join(ROOT, ".env.production") },
      timeout: 60_000,
    });
    const reason = (run.stdout + run.stderr).trim().split("\n").pop() ?? "";
    offsite = { fresh: run.status === 0, detail: reason.replace(/^\S+\s+/, "").slice(0, 160) };
  }

  return {
    app: { up: appUp, detail: appUp ? "" : app.status ? `answered ${app.status}` : app.reason },
    reminders: reminders ? { configured: Boolean(reminders.configured), lastTickSecondsAgo: reminders.lastTickSecondsAgo } : { configured: false, lastTickSecondsAgo: null },
    ntfy: { configured: Boolean(cfg.token), up: ntfyUp, detail: ntfyUp ? "" : ntfyResult?.status ? `answered ${ntfyResult.status}` : (ntfyResult?.reason ?? "not configured") },
    backup: { ageHours, detail: "" },
    offsite,
  };
}

function readState(stateDir) {
  try {
    const parsed = JSON.parse(readFileSync(path.join(stateDir, "watch.json"), "utf8"));
    return Object.fromEntries(WATCH_CHECKS.map((check) => [check, { failures: Number(parsed[check]?.failures) || 0, alerted: parsed[check]?.alerted === true }]));
  } catch {
    return EMPTY_STATE;
  }
}

async function runPass() {
  const cfg = settings();
  const now = new Date();
  const observations = await observe(cfg, now);
  const previous = readState(cfg.stateDir);
  const { state, alerts } = decide(previous, observations, now);

  for (const alert of alerts) {
    const sent = await sendAlert(cfg, alert.title, alert.body);
    if (sent.sent) {
      log(cfg.stateDir, `alert sent: ${alert.title}`);
      continue;
    }
    log(cfg.stateDir, `alert not sent (${sent.reason}): ${alert.title}`);
    // Not delivered, so it is tried again next run: a failure is announced once it can be, and a recovery
    // is announced once it can be.
    state[alert.check] = { ...state[alert.check], alerted: alert.kind === "recover" };
  }

  mkdirSync(cfg.stateDir, { recursive: true });
  writeFileSync(path.join(cfg.stateDir, "watch.json"), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  return { alerts: alerts.length };
}

/** `--notify`: one message now, from a failing script. Never fails the caller: its own error is the real one. */
async function notifyNow(title, body) {
  const cfg = settings();
  const sent = await sendAlert(cfg, title, body);
  if (!sent.sent) {
    console.error(`could not send the alert (${sent.reason}): ${title}`);
    return;
  }
  log(cfg.stateDir, `alert sent: ${title}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--notify") {
    await notifyNow(args[1] ?? "Anamnesis: a job failed", args[2] ?? "See ops/state for the log.");
    return;
  }
  await runPass();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`watch: ${error instanceof Error ? error.message : "failed"}`);
    process.exitCode = 1;
  });
}
