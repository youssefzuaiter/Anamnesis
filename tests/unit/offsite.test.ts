/**
 * Encrypted off-machine copies (ROADMAP item 28): ops/offsite.sh, ops/decrypt-backup.sh. They are shell
 * scripts, so these tests run them for real against temporary folders and a real `age`. No Docker: the
 * scripts under test work on backup folders and files only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const OFFSITE = path.join(ROOT, "ops/offsite.sh");
const DECRYPT = path.join(ROOT, "ops/decrypt-backup.sh");
const have = spawnSync("age", ["--version"]).status === 0 && spawnSync("age-keygen", ["--version"]).status === 0;
// Locally a missing `age` skips these with a reason; in CI it is a failure, because a skipped test there
// would mean the encryption was never tested.
const skip = have ? false : process.env.CI ? undefined : "age is not installed (brew install age)";
if (!have && process.env.CI) throw new Error("age must be installed in CI (.github/scripts/install-age.sh)");

const dirs: string[] = [];
function temp(label: string) {
  const dir = mkdtempSync(path.join(tmpdir(), `offsite-${label}-`));
  dirs.push(dir);
  return dir;
}
process.on("exit", () => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function keypair() {
  const identityFile = path.join(temp("key"), "key.txt");
  const made = spawnSync("age-keygen", ["-o", identityFile], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const recipient = /age1[0-9a-z]+/.exec(made.stderr + made.stdout)![0];
  return { identityFile, recipient };
}

function backup(backupDir: string, stamp: string, sentinel = `SENTINEL-${stamp}`) {
  const dir = path.join(backupDir, `anamnesis-${stamp}`);
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    "database.dump": `PGDMP\u0000${sentinel}\u0000${"row ".repeat(500)}`,
    "attachments.tar": `ATTACH-${sentinel}`,
    "counts.txt": "User 1\nNote 2\n",
    "manifest.json": `{"created":"${stamp}"}\n`,
  };
  let sums = "";
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content);
    sums += `${createHash("sha256").update(content).digest("hex")}  ${name}\n`;
  }
  writeFileSync(path.join(dir, "SHA256SUMS"), sums);
  return { dir, files, sentinel };
}

function run(script: string, args: string[], env: Record<string, string | undefined>) {
  const result = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ANAMNESIS_ENV_FILE: "/nonexistent/env", ANAMNESIS_STATE_DIR: temp("state"), ...env } as unknown as NodeJS.ProcessEnv,
  });
  return { status: result.status, out: result.stdout, err: result.stderr, all: result.stdout + result.stderr };
}

function setup() {
  const backups = temp("backups");
  const dest = temp("dest");
  const { identityFile, recipient } = keypair();
  const env = { ANAMNESIS_BACKUP_DIR: backups, ANAMNESIS_OFFSITE_DIR: dest, ANAMNESIS_OFFSITE_RECIPIENT: recipient };
  return { backups, dest, identityFile, recipient, env };
}
const copies = (dest: string) => readdirSync(dest).filter((n) => n.endsWith(".tar.age") && !n.startsWith(".")).sort();

test("not configured: nothing to do, and the check has nothing to complain about", { skip }, () => {
  const backups = temp("backups");
  const plain = { ANAMNESIS_BACKUP_DIR: backups };
  const copy = run(OFFSITE, [], plain);
  assert.equal(copy.status, 0, copy.all);
  assert.match(copy.all, /not configured/i);
  const check = run(OFFSITE, ["--check"], plain);
  assert.equal(check.status, 0, check.all);
  assert.match(check.all, /not configured/i);
});

test("half a configuration, a private key as the recipient, and a nonsense recipient are all refused", { skip }, () => {
  const { backups, dest, recipient, env } = setup();
  backup(backups, "20261110T031500Z");
  assert.notEqual(run(OFFSITE, [], { ANAMNESIS_BACKUP_DIR: backups, ANAMNESIS_OFFSITE_DIR: dest }).status, 0, "a folder and no recipient");
  assert.notEqual(run(OFFSITE, [], { ANAMNESIS_BACKUP_DIR: backups, ANAMNESIS_OFFSITE_RECIPIENT: recipient }).status, 0, "a recipient and no folder");

  const secret = "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ";
  const leaked = run(OFFSITE, [], { ...env, ANAMNESIS_OFFSITE_RECIPIENT: secret });
  assert.notEqual(leaked.status, 0);
  assert.ok(!leaked.all.includes(secret) && !leaked.all.includes("QQQQQQQQQQQQ"), "the private key is never echoed");
  assert.match(leaked.all, /private key/i);

  for (const bad of ["not a key", "age1", "ssh-rsa AAAA", "age1 UPPER", "$(touch /tmp/pwned)", "age1qqq; touch /tmp/pwned"]) {
    const refused = run(OFFSITE, [], { ...env, ANAMNESIS_OFFSITE_RECIPIENT: bad });
    assert.notEqual(refused.status, 0, bad);
    assert.match(refused.all, /not an age public key/, `${bad}: stopped by the script's own check, before age or a shell sees it`);
  }
  assert.deepEqual(readdirSync(dest), [], "nothing was written for any of them");
  assert.ok(!existsSync("/tmp/pwned"));
});

test("a folder that is missing (the drive is not plugged in) is exit 3 and a plain sentence; one inside the backups is refused", { skip }, () => {
  const { backups, env } = setup();
  backup(backups, "20261110T031500Z");
  const missing = run(OFFSITE, [], { ...env, ANAMNESIS_OFFSITE_DIR: path.join(temp("gone"), "not-mounted") });
  assert.equal(missing.status, 3, missing.all);
  assert.match(missing.all, /not available|plugged in|mounted/i);
  const inside = run(OFFSITE, [], { ...env, ANAMNESIS_OFFSITE_DIR: backups });
  assert.notEqual(inside.status, 0);
  assert.match(inside.all, /different folder|same folder|inside/i);
});

test("each finished backup becomes one encrypted file; the plaintext is nowhere in it and the wrong key cannot open it", { skip }, () => {
  const { backups, dest, identityFile, env } = setup();
  const one = backup(backups, "20261110T031500Z");
  const two = backup(backups, "20261111T031500Z");
  backup(backups, "20261112T031500Z"); // complete, but the next ones are not:
  rmSync(path.join(backups, "anamnesis-20261112T031500Z/SHA256SUMS"));
  mkdirSync(path.join(backups, ".incomplete-20261113T031500Z"));
  writeFileSync(path.join(backups, "anamnesis-notes.txt"), "stray");
  mkdirSync(path.join(backups, "anamnesis-notes")); // a folder that is not named like a backup, with checksums
  writeFileSync(path.join(backups, "anamnesis-notes/SHA256SUMS"), "");

  const result = run(OFFSITE, [], env);
  assert.equal(result.status, 0, result.all);
  assert.deepEqual(copies(dest), ["anamnesis-20261110T031500Z.tar.age", "anamnesis-20261111T031500Z.tar.age"]);
  assert.deepEqual(readdirSync(dest).filter((n) => !n.endsWith(".tar.age")), [], "no half-written file is left");

  for (const [stamp, b] of [["20261110T031500Z", one], ["20261111T031500Z", two]] as const) {
    const file = path.join(dest, `anamnesis-${stamp}.tar.age`);
    const bytes = readFileSync(file);
    assert.ok(!bytes.includes(b.sentinel) && !bytes.includes("PGDMP") && !bytes.includes("User 1"), "the copy holds no readable data");
    assert.equal(statSync(file).mode & 0o777, 0o600, "owner-only");
    assert.ok(bytes.subarray(0, 21).toString().startsWith("age-encryption.org/v1"), "an age file");
  }

  // The right key opens it; another does not.
  const wrong = keypair();
  const file = path.join(dest, "anamnesis-20261110T031500Z.tar.age");
  assert.equal(spawnSync("age", ["-d", "-i", wrong.identityFile], { input: readFileSync(file) }).status, 1);
  const right = spawnSync("age", ["-d", "-i", identityFile], { input: readFileSync(file) });
  assert.equal(right.status, 0);
  assert.ok(right.stdout.includes(one.sentinel), "the right key gets the data back");
});

test("a second run copies nothing and rewrites nothing; a new backup is added", { skip }, () => {
  const { backups, dest, env } = setup();
  backup(backups, "20261110T031500Z");
  assert.equal(run(OFFSITE, [], env).status, 0);
  const file = path.join(dest, "anamnesis-20261110T031500Z.tar.age");
  const past = new Date("2026-11-10T12:00:00Z");
  utimesSync(file, past, past);
  const before = statSync(file).mtimeMs;
  const again = run(OFFSITE, [], env);
  assert.equal(again.status, 0, again.all);
  assert.equal(statSync(file).mtimeMs, before, "an existing copy is left exactly as it was");
  backup(backups, "20261111T031500Z");
  assert.equal(run(OFFSITE, [], env).status, 0);
  assert.equal(copies(dest).length, 2);
});

test("two runs at once leave one whole, decryptable copy per backup and no temporary files; stale temporary files are removed", { skip }, async () => {
  const { backups, dest, identityFile, env } = setup();
  for (let i = 1; i <= 6; i++) backup(backups, `2026111${i}T031500Z`);
  const stale = path.join(dest, ".incomplete-anamnesis-20200101T000000Z.99999.tar.age");
  const young = path.join(dest, ".incomplete-anamnesis-20200102T000000Z.99998.tar.age");
  const other = path.join(dest, ".incomplete-my-own-file");
  for (const f of [stale, young, other]) writeFileSync(f, "x");
  const old = new Date(Date.now() - 3 * 86_400_000);
  utimesSync(stale, old, old);
  utimesSync(other, old, old);
  const start = () =>
    new Promise<number | null>((resolve) => {
      const child = spawn("bash", [OFFSITE], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ANAMNESIS_ENV_FILE: "/nonexistent/env", ANAMNESIS_STATE_DIR: temp("state"), ...env } as unknown as NodeJS.ProcessEnv });
      child.on("close", resolve);
    });
  const codes = await Promise.all([start(), start()]);
  assert.deepEqual(codes, [0, 0]);
  assert.equal(copies(dest).length, 6);
  const left = readdirSync(dest).filter((n) => !n.endsWith(".tar.age") || n.startsWith("."));
  assert.deepEqual(left.sort(), [".incomplete-anamnesis-20200102T000000Z.99998.tar.age", ".incomplete-my-own-file"].sort(), "only a recent temporary file and a file that is not ours remain");
  for (const name of copies(dest)) {
    const opened = spawnSync("age", ["-d", "-i", identityFile], { input: readFileSync(path.join(dest, name)) });
    assert.equal(opened.status, 0, `${name} opens`);
    assert.ok(opened.stdout.length > 1000);
  }
});

test("an encryption that fails leaves no file behind and says so; the backups are untouched", { skip }, () => {
  const { backups, dest, env } = setup();
  const b = backup(backups, "20261110T031500Z");
  // Looks like an age recipient but its checksum is wrong, so age itself refuses it.
  const result = run(OFFSITE, [], { ...env, ANAMNESIS_OFFSITE_RECIPIENT: `age1${"q".repeat(58)}` });
  assert.notEqual(result.status, 0, result.all);
  assert.deepEqual(readdirSync(dest), [], "no copy, and no .incomplete file");
  assert.ok(existsSync(path.join(b.dir, "database.dump")));
});

test("old copies are pruned by the same policy, and nothing else in the folder is touched", { skip }, () => {
  const { backups, dest, env } = setup();
  const day = (n: number) => {
    const d = new Date(Date.now() - n * 86_400_000);
    const p = (x: number) => String(x).padStart(2, "0");
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T031500Z`;
  };
  // Forty daily copies already on the drive; today's backup is the one to add.
  for (let n = 1; n <= 40; n++) writeFileSync(path.join(dest, `anamnesis-${day(n)}.tar.age`), "old");
  writeFileSync(path.join(dest, "photos.zip"), "mine");
  writeFileSync(path.join(dest, `anamnesis-${day(40)}.tar.zip`), "not a copy (same length of extension)");
  writeFileSync(path.join(dest, "anamnesis-latest.tar.age"), "not a stamp");
  backup(backups, day(0));
  const result = run(OFFSITE, [], env);
  assert.equal(result.status, 0, result.all);
  const left = readdirSync(dest);
  assert.ok(left.includes("photos.zip") && left.includes("anamnesis-latest.tar.age") && left.includes(`anamnesis-${day(40)}.tar.zip`), "files that are not copies stay");
  assert.ok(left.includes(`anamnesis-${day(0)}.tar.age`) && left.includes(`anamnesis-${day(1)}.tar.age`) && left.includes(`anamnesis-${day(6)}.tar.age`), "the last week stays");
  assert.ok(!left.includes(`anamnesis-${day(40)}.tar.age`) || copies(dest).length < 41, "something old went");
  assert.ok(copies(dest).length < 41 && copies(dest).length >= 9, `kept ${copies(dest).length}`);
});

test("--check passes for a fresh copy and fails for none, a stale one, or a drive that is not there", { skip }, () => {
  const { backups, dest, env } = setup();
  assert.equal(run(OFFSITE, ["--check"], env).status, 1, "an empty folder");
  backup(backups, "20200101T031500Z");
  assert.equal(run(OFFSITE, [], env).status, 0);
  assert.equal(run(OFFSITE, ["--check"], env).status, 1, "a copy from 2020 is not fresh");

  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  const now = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  writeFileSync(path.join(dest, `anamnesis-${now}.tar.age`), "x");
  const fresh = run(OFFSITE, ["--check"], env);
  assert.equal(fresh.status, 0, fresh.all);
  const gone = run(OFFSITE, ["--check"], { ...env, ANAMNESIS_OFFSITE_DIR: path.join(temp("gone"), "not-mounted") });
  assert.equal(gone.status, 1, gone.all);
  assert.match(gone.all, /not available|plugged in|mounted/i);
});

// --- decrypting ----------------------------------------------------------------------------------

test("a copy decrypts into a normal backup folder with every file identical and its checksums passing", { skip }, () => {
  const { backups, dest, identityFile, env } = setup();
  const b = backup(backups, "20261110T031500Z");
  assert.equal(run(OFFSITE, [], env).status, 0);
  const out = path.join(temp("out"), "restored");
  const result = run(DECRYPT, [path.join(dest, "anamnesis-20261110T031500Z.tar.age"), "--identity", identityFile, "--out", out], env);
  assert.equal(result.status, 0, result.all);
  const printed = result.out.trim();
  assert.equal(printed, path.join(out, "anamnesis-20261110T031500Z"), "stdout is the backup folder and nothing else");
  for (const [name, content] of Object.entries(b.files)) assert.equal(readFileSync(path.join(printed, name), "utf8"), content, name);
  assert.equal(statSync(out).mode & 0o777, 0o700, "owner-only");
  // It is exactly what verify-backup.sh and restore.sh take: a folder with SHA256SUMS that passes.
  assert.ok(existsSync(path.join(printed, "SHA256SUMS")));
});

test("the wrong key, a damaged file, a missing key file and an existing folder are all refused and leave nothing", { skip }, () => {
  const { backups, dest, identityFile, env } = setup();
  backup(backups, "20261110T031500Z");
  run(OFFSITE, [], env);
  const file = path.join(dest, "anamnesis-20261110T031500Z.tar.age");
  const outFor = () => path.join(temp("out"), "restored");

  const wrong = outFor();
  const w = run(DECRYPT, [file, "--identity", keypair().identityFile, "--out", wrong], env);
  assert.notEqual(w.status, 0);
  assert.match(w.all, /could not decrypt/i);
  assert.ok(!existsSync(wrong), "no partial folder");

  const bytes = readFileSync(file);
  const damaged = path.join(temp("dmg"), "anamnesis-20261110T031500Z.tar.age");
  const flipped = Buffer.from(bytes);
  flipped[flipped.length - 20] ^= 0xff;
  writeFileSync(damaged, flipped);
  const dOut = outFor();
  assert.notEqual(run(DECRYPT, [damaged, "--identity", identityFile, "--out", dOut], env).status, 0);
  assert.ok(!existsSync(dOut));

  const truncated = path.join(temp("trunc"), "anamnesis-20261110T031500Z.tar.age");
  writeFileSync(truncated, bytes.subarray(0, bytes.length - 40));
  assert.notEqual(run(DECRYPT, [truncated, "--identity", identityFile, "--out", outFor()], env).status, 0);

  assert.notEqual(run(DECRYPT, [file, "--identity", "/nonexistent/key.txt", "--out", outFor()], env).status, 0);
  const existing = temp("exists");
  const there = run(DECRYPT, [file, "--identity", identityFile, "--out", existing], env);
  assert.notEqual(there.status, 0, "never decrypts into a folder that is already there");
  assert.match(there.all, /already exists/);
  assert.deepEqual(readdirSync(existing), [], "and does not touch it");
  assert.notEqual(run(DECRYPT, [file, "--out", outFor()], env).status, 0, "no key given");
});

/** One ustar entry, built by hand so the test does not depend on the local tar's options. */
function tarEntry(name: string, content = "", type = "0", linkname = "") {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(type === "5" ? "0000755\0" : "0000644\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.write("        ", 148);
  header.write(type, 156);
  header.write(linkname, 157, 100, "utf8");
  header.write("ustar\0", 257);
  header.write("00", 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  const body = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  body.write(content, 0, "utf8");
  return Buffer.concat([header, body]);
}
const tarOf = (...entries: Buffer[]) => Buffer.concat([...entries, Buffer.alloc(1024)]);

/** A valid copy's entries (folder, one file, matching checksums), so a forgery below breaks exactly one rule. */
function legit(name: string) {
  const data = "data";
  return [tarEntry(`${name}/`, "", "5"), tarEntry(`${name}/database.dump`, data), tarEntry(`${name}/SHA256SUMS`, `${createHash("sha256").update(data).digest("hex")}  database.dump\n`)];
}

test("a forged copy (anyone who can write to the drive can encrypt to the public key) is refused, one broken rule at a time", { skip }, () => {
  const { dest, identityFile, recipient, env } = setup();
  const name = "anamnesis-20261110T031500Z";
  const forged: [string, Buffer, RegExp][] = [
    ["a good copy, to be sure the harness accepts one", tarOf(...legit(name)), /^$/],
    ["a path that climbs out", tarOf(...legit(name), tarEntry(`${name}/../../escaped.txt`, "pwned")), /./],
    ["an absolute path", tarOf(...legit(name), tarEntry("/tmp/escaped-absolute.txt", "pwned")), /outside/],
    ["another folder", tarOf(...legit(name), tarEntry("other/file", "x")), /outside/],
    ["a symbolic link", tarOf(...legit(name), tarEntry(`${name}/link`, "", "2", "/etc/passwd")), /plain files/],
    ["a hard link", tarOf(...legit(name), tarEntry(`${name}/hardlink`, "", "1", `${name}/database.dump`)), /plain files/],
    ["a device", tarOf(...legit(name), tarEntry(`${name}/null`, "", "3")), /plain files/],
    ["a nested folder", tarOf(...legit(name), tarEntry(`${name}/sub/`, "", "5"), tarEntry(`${name}/sub/file`, "x")), /outside/],
    ["a hidden file", tarOf(...legit(name), tarEntry(`${name}/.hidden`, "x")), /outside/],
    ["a second backup folder", tarOf(...legit(name), tarEntry("anamnesis-20261111T031500Z/", "", "5")), /outside/],
    ["no checksums", tarOf(tarEntry(`${name}/`, "", "5"), tarEntry(`${name}/database.dump`, "x")), /no SHA256SUMS/],
    ["only the stamp, no folder", tarOf(tarEntry(name, "x")), /outside/],
  ];
  for (const [label, tar, expected] of forged) {
    const file = path.join(dest, `${name}.tar.age`);
    assert.equal(spawnSync("age", ["-r", recipient, "-o", file], { input: tar }).status, 0);
    const parent = temp("evil");
    const out = path.join(parent, "restored");
    const result = run(DECRYPT, [file, "--identity", identityFile, "--out", out], env);
    if (label.startsWith("a good copy")) {
      assert.equal(result.status, 0, `${label}: ${result.all}`);
    } else {
      assert.notEqual(result.status, 0, `${label}: ${result.all}`);
      assert.match(result.all, expected, label);
      assert.ok(!existsSync(out), `${label}: nothing is left behind`);
    }
    assert.ok(!existsSync(path.join(parent, "escaped.txt")) && !existsSync(path.join(path.dirname(parent), "escaped.txt")) && !existsSync("/tmp/escaped-absolute.txt"), `${label}: nothing outside`);
    rmSync(file);
  }
});

test("a copy whose contents do not match their own checksums is refused", { skip }, () => {
  const { dest, identityFile, recipient, env } = setup();
  const name = "anamnesis-20261110T031500Z";
  const good = createHash("sha256").update("real").digest("hex");
  const tar = tarOf(tarEntry(`${name}/`, "", "5"), tarEntry(`${name}/database.dump`, "tampered"), tarEntry(`${name}/SHA256SUMS`, `${good}  database.dump\n`));
  const file = path.join(dest, `${name}.tar.age`);
  assert.equal(spawnSync("age", ["-r", recipient, "-o", file], { input: tar }).status, 0);
  const out = path.join(temp("sum"), "restored");
  const result = run(DECRYPT, [file, "--identity", identityFile, "--out", out], env);
  assert.notEqual(result.status, 0);
  assert.match(result.all, /checksum/i);
  assert.ok(!existsSync(out));
});

test("a file whose name is not a copy's name is refused", { skip }, () => {
  const { backups, dest, identityFile, env } = setup();
  backup(backups, "20261110T031500Z");
  run(OFFSITE, [], env);
  const renamed = path.join(dest, "backup.tar.age");
  writeFileSync(renamed, readFileSync(path.join(dest, "anamnesis-20261110T031500Z.tar.age")));
  chmodSync(renamed, 0o600);
  const out = path.join(temp("name"), "restored");
  const result = run(DECRYPT, [renamed, "--identity", identityFile, "--out", out], env);
  assert.notEqual(result.status, 0);
  assert.match(result.all, /not named like a copy/);
  assert.ok(!existsSync(out));
});
