#!/usr/bin/env node
/**
 * Post-deploy smoke check. Answers one question: is the thing that is running
 * now the release I meant to run, and can it do the basic things it exists for?
 *
 *   node ops/smoke.mjs [--url http://127.0.0.1:3200]
 *                      [--expect-version <commit>] [--expect-migrations <n>]
 *                      [--skip-ollama] [--wait-seconds 120]
 *
 * It only reads. Without credentials it never creates anything; with
 * SMOKE_EMAIL and SMOKE_PASSWORD it also signs in as that (already existing)
 * account and reads that account's own export, which is the one check that
 * exercises sessions, the database and a data endpoint together.
 *
 * No dependencies on purpose: it runs on a host with nothing but Node, in CI,
 * and inside the production image.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

const base = (option("url", process.env.SMOKE_URL ?? "http://127.0.0.1:3200")).replace(/\/$/, "");
const expectVersion = option("expect-version", process.env.SMOKE_EXPECT_VERSION);
const skipOllama = flag("skip-ollama");
const waitSeconds = Number(option("wait-seconds", "120"));
const REQUEST_TIMEOUT_MS = 10_000;

// Counts the migration folders of the release being checked. The deep health
// endpoint reports how many the database has applied; a mismatch means the app
// came up against a schema nobody migrated.
function migrationsInThisCheckout() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations");
  if (!existsSync(root)) return null;
  return readdirSync(root).filter((name) => statSync(path.join(root, name)).isDirectory()).length;
}
const expectMigrations = option("expect-migrations")
  ? Number(option("expect-migrations"))
  : migrationsInThisCheckout();

let failures = 0;
function report(ok, label, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function request(pathname, init = {}) {
  return fetch(`${base}${pathname}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...init,
  });
}

// A freshly restarted app needs a moment. Waiting here, rather than failing on
// the first refused connection, is what lets the deploy script call this
// straight after `docker compose up`.
async function waitUntilAnswering() {
  const deadline = Date.now() + waitSeconds * 1000;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await request("/api/health");
      if (response.status === 200) return true;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  console.log(`FAIL  the app did not become healthy within ${waitSeconds}s  — last: ${last}`);
  return false;
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}
function remember(jar, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const at = pair.indexOf("=");
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
}

async function signedInChecks(email, password) {
  const jar = new Map();

  const csrfResponse = await request("/api/auth/csrf");
  remember(jar, csrfResponse);
  const { csrfToken } = await csrfResponse.json();

  const login = await request("/api/auth/callback/credentials", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
  });
  remember(jar, login);
  const signedIn = [...jar.keys()].some((name) => name.includes("session-token"));
  report(signedIn, "signing in as the smoke account works");
  if (!signedIn) return;

  const dashboard = await request("/", { headers: { Cookie: cookieHeader(jar) } });
  report(dashboard.status === 200, "the dashboard renders for a signed-in user", `HTTP ${dashboard.status}`);

  const exported = await request("/api/export", { headers: { Cookie: cookieHeader(jar) } });
  let ownEmail = "";
  if (exported.status === 200) ownEmail = (await exported.json()).user?.email ?? "";
  report(
    exported.status === 200 && ownEmail === email.toLowerCase(),
    "the account's own data comes back from the database",
    `HTTP ${exported.status}`,
  );
}

console.log(`Smoke check against ${base}`);

if (!(await waitUntilAnswering())) process.exit(1);

// 1. Health, shallow and deep.
const shallow = await (await request("/api/health")).json();
report(shallow.status === "ok" && shallow.checks?.database?.ok === true, "the database answers");

const deepResponse = await request("/api/health?deep=1");
const deep = await deepResponse.json();
report(deepResponse.status === 200 && deep.checks?.vector?.ok === true, "pgvector is installed");
report(deep.checks?.migrations?.ok === true, "migrations have been applied", `${deep.checks?.migrations?.applied ?? 0} applied`);
if (expectMigrations !== null) {
  report(
    deep.checks?.migrations?.applied === expectMigrations,
    "every migration in this release is applied",
    `${deep.checks?.migrations?.applied} applied, ${expectMigrations} expected`,
  );
}
if (skipOllama) {
  console.log("SKIP  Ollama and its models (--skip-ollama)");
} else {
  report(deep.checks?.ollama?.ok === true, "Ollama is reachable");
  report(deep.checks?.ollama?.models === true, "both models the app uses are installed");
}
if (expectVersion) {
  report(deep.version === expectVersion, "the running release is the one that was deployed", `running ${deep.version}, expected ${expectVersion}`);
}

// 2. The app serves pages and assets.
const login = await request("/login");
const loginHtml = login.status === 200 ? await login.text() : "";
report(login.status === 200 && loginHtml.includes("Sign in"), "the login page renders", `HTTP ${login.status}`);

const asset = loginHtml.match(/\/_next\/static\/[^"')\s]+\.js/)?.[0];
if (asset) {
  const response = await request(asset);
  report(response.status === 200, "static assets are served", `HTTP ${response.status}`);
} else {
  report(false, "static assets are served", "the login page links no script to check");
}

const manifest = await request("/manifest.webmanifest");
report(manifest.status === 200, "the web app manifest is served", `HTTP ${manifest.status}`);

// 3. Data stays behind a session. These are the two ways a bad deploy would
// quietly expose everything, so they are asserted exactly, not loosely.
const home = await request("/");
report(
  [302, 303, 307, 308].includes(home.status) && (home.headers.get("location") ?? "").includes("/login"),
  "an anonymous visitor is sent to the login page",
  `HTTP ${home.status}`,
);
const anonymousExport = await request("/api/export");
report(anonymousExport.status === 401, "an anonymous request for the data export is refused", `HTTP ${anonymousExport.status}`);

// 4. Optional: a real signed-in round trip.
if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
  await signedInChecks(process.env.SMOKE_EMAIL, process.env.SMOKE_PASSWORD);
} else {
  console.log("SKIP  signed-in round trip (set SMOKE_EMAIL and SMOKE_PASSWORD to enable it)");
}

console.log(failures === 0 ? "\nSMOKE PASSED" : `\nSMOKE FAILED (${failures} check${failures === 1 ? "" : "s"})`);
process.exit(failures === 0 ? 0 : 1);
